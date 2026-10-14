"""What can be done to cards and notes, from the study screen and the browser."""

from __future__ import annotations

from anki.cards import Card
from anki.config import Config
from anki.scheduler.base import ScheduleCardsAsNew
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection
from ..render import av_tags, body_class, prepare

router = APIRouter(prefix="/api")


def _undo(col) -> dict:
    s = col.undo_status()
    return {"undo": s.undo, "redo": s.redo}


def _changed(uc: UserCollection, col, resets_review: bool = False, **extra) -> dict:
    if resets_review:
        # The card the study screen had may be gone from the queue: it fetches anew.
        uc.session.pop("review", None)
    return {"undo": _undo(col), **extra}


class CardIds(BaseModel):
    cardIds: list[int]


class NoteIds(BaseModel):
    noteIds: list[int]


# ---- flags, marks -------------------------------------------------------------------


class Flag(CardIds):
    flag: int


@router.post("/cards/flag")
def flag(body: Flag, uc: UserCollection = Depends(current_user)) -> dict:
    if not 0 <= body.flag <= 7:
        raise HTTPException(400, "flag must be 0-7")
    with uc.use() as col:
        col.set_user_flag_for_cards(body.flag, body.cardIds)
        return _changed(uc, col)


class Mark(NoteIds):
    # None toggles: marked if any of them isn't
    marked: bool | None = None


@router.post("/notes/mark")
def mark(body: Mark, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        marked = body.marked
        if marked is None:
            marked = not all(col.get_note(n).has_tag("marked") for n in body.noteIds)
        if marked:
            col.tags.bulk_add(body.noteIds, "marked")
        else:
            col.tags.bulk_remove(body.noteIds, "marked")
        return _changed(uc, col, marked=marked)


@router.get("/flags")
def flag_names(uc: UserCollection = Depends(current_user)) -> list[dict]:
    """The seven flags with their user-chosen names (desktop: Browser > Flag > Rename)."""
    with uc.use() as col:
        custom = col.get_config("flagLabels", {}) or {}
        defaults = ["Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"]
        return [{"flag": i + 1, "name": custom.get(str(i + 1)) or defaults[i]} for i in range(7)]


class FlagName(BaseModel):
    flag: int
    name: str


@router.post("/flags/rename")
def rename_flag(body: FlagName, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        labels = dict(col.get_config("flagLabels", {}) or {})
        if body.name.strip():
            labels[str(body.flag)] = body.name.strip()
        else:
            labels.pop(str(body.flag), None)
        col.set_config("flagLabels", labels)
        return {"ok": True}


# ---- bury, suspend, delete ----------------------------------------------------------


@router.post("/cards/bury")
def bury_cards(body: CardIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.sched.bury_cards(body.cardIds, manual=True)
        return _changed(uc, col, count=out.count, resets_review=True)


@router.post("/notes/bury")
def bury_notes(body: NoteIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.sched.bury_notes(body.noteIds)
        return _changed(uc, col, count=out.count, resets_review=True)


class Toggle(CardIds):
    # None toggles: suspends unless all are suspended already
    suspend: bool | None = None


@router.post("/cards/suspend")
def suspend_cards(body: Toggle, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        suspend = body.suspend
        if suspend is None:
            suspend = not all(col.get_card(c).queue == -1 for c in body.cardIds)
        if suspend:
            out = col.sched.suspend_cards(body.cardIds)
            count = out.count
        else:
            col.sched.unsuspend_cards(body.cardIds)
            count = len(body.cardIds)
        return _changed(uc, col, suspended=suspend, count=count, resets_review=True)


@router.post("/notes/suspend")
def suspend_notes(body: NoteIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.sched.suspend_notes(body.noteIds)
        return _changed(uc, col, count=out.count, resets_review=True)


@router.post("/cards/unbury")
def unbury_cards(body: CardIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.sched.unbury_cards(body.cardIds)
        return _changed(uc, col)


@router.post("/notes/delete")
def delete_notes(body: NoteIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.remove_notes(body.noteIds)
        return _changed(uc, col, count=out.count, resets_review=True)


@router.post("/cards/delete-notes")
def delete_notes_of_cards(body: CardIds, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        nids = list({col.get_card(c).nid for c in body.cardIds})
        out = col.remove_notes(nids)
        return _changed(uc, col, count=out.count, resets_review=True)


# ---- scheduling -----------------------------------------------------------------------


class SetDue(CardIds):
    # "0" today, "1" tomorrow, "3-7" a random day in the range; a trailing "!" also
    # sets the interval to that many days
    days: str


@router.post("/cards/set-due")
def set_due(body: SetDue, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        try:
            col.sched.set_due_date(body.cardIds, body.days, Config.String.SET_DUE_REVIEWER)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return _changed(uc, col, resets_review=True)


@router.get("/cards/set-due-default")
def set_due_default(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return {"days": col.get_config_string(Config.String.SET_DUE_REVIEWER)}


class Forget(CardIds):
    restorePosition: bool = True
    resetCounts: bool = False


@router.post("/cards/forget")
def forget(body: Forget, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.sched.schedule_cards_as_new(
            body.cardIds, restore_position=body.restorePosition, reset_counts=body.resetCounts,
            context=ScheduleCardsAsNew.Context.REVIEWER,
        )
        return _changed(uc, col, resets_review=True)


@router.get("/cards/forget-defaults")
def forget_defaults(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        d = col.sched.schedule_cards_as_new_defaults(ScheduleCardsAsNew.Context.BROWSER)
        return {"restorePosition": d.restore_position, "resetCounts": d.reset_counts}


class Reposition(CardIds):
    start: int = 0
    step: int = 1
    randomize: bool = False
    shift: bool = False


@router.post("/cards/reposition")
def reposition(body: Reposition, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.sched.reposition_new_cards(body.cardIds, body.start, body.step, body.randomize, body.shift)
        return _changed(uc, col, count=out.count, resets_review=True)


@router.get("/cards/reposition-defaults")
def reposition_defaults(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        d = col.sched.reposition_defaults()
        return {"randomize": d.random, "shift": d.shift}


class SetDeck(CardIds):
    deckId: int


@router.post("/cards/set-deck")
def set_deck(body: SetDeck, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.set_deck(body.cardIds, body.deckId)
        return _changed(uc, col, resets_review=True)


# ---- tags -----------------------------------------------------------------------------


@router.get("/tags")
def all_tags(uc: UserCollection = Depends(current_user)) -> list[str]:
    with uc.use() as col:
        return sorted(col.tags.all(), key=str.lower)


class EditTags(NoteIds):
    add: str = ""
    remove: str = ""


@router.post("/notes/tags")
def edit_tags(body: EditTags, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        if body.add.strip():
            col.tags.bulk_add(body.noteIds, body.add)
        if body.remove.strip():
            col.tags.bulk_remove(body.noteIds, body.remove)
        return _changed(uc, col)


class SetTags(BaseModel):
    noteId: int
    tags: list[str]


@router.post("/notes/set-tags")
def set_tags(body: SetTags, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        note = col.get_note(body.noteId)
        note.tags = [t for t in body.tags if t.strip()]
        col.update_note(note)
        return _changed(uc, col)


@router.get("/notes/{nid}/tags")
def note_tags(nid: int, uc: UserCollection = Depends(current_user)) -> list[str]:
    with uc.use() as col:
        return list(col.get_note(nid).tags)


@router.post("/tags/clear-unused")
def clear_unused_tags(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return {"count": col.tags.clear_unused_tags().count}


class RenameTag(BaseModel):
    old: str
    new: str


@router.post("/tags/rename")
def rename_tag(body: RenameTag, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return {"count": col.tags.rename(body.old, body.new).count}


class RemoveTags(BaseModel):
    tags: str


@router.post("/tags/remove")
def remove_tags(body: RemoveTags, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return {"count": col.tags.remove(body.tags).count}


# ---- find and replace -------------------------------------------------------------------


class FindReplace(NoteIds):
    search: str
    replacement: str
    regex: bool = False
    matchCase: bool = False
    # None: every field; "tags" for tags
    field: str | None = None


@router.post("/notes/find-replace")
def find_replace(body: FindReplace, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        try:
            if body.field == "tags":
                out = col.tags.find_and_replace(
                    note_ids=body.noteIds, search=body.search, replacement=body.replacement,
                    regex=body.regex, match_case=body.matchCase,
                )
            else:
                out = col.find_and_replace(
                    note_ids=body.noteIds, search=body.search, replacement=body.replacement,
                    regex=body.regex, field_name=body.field, match_case=body.matchCase,
                )
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return _changed(uc, col, count=out.count)


@router.post("/notes/field-names")
def field_names(body: NoteIds, uc: UserCollection = Depends(current_user)) -> list[str]:
    with uc.use() as col:
        return list(col.field_names_for_note_ids(body.noteIds))


# ---- one card ---------------------------------------------------------------------------


@router.get("/cards/{cid}")
def card_info(cid: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        card = col.get_card(cid)
        note = card.note()
        return {
            "id": card.id,
            "noteId": card.nid,
            "deckId": card.did,
            "flag": card.user_flag(),
            "marked": note.has_tag("marked"),
            "suspended": card.queue == -1,
            "buried": card.queue in (-2, -3),
            "siblings": len(note.card_ids()),
            "notetypeId": note.mid,
        }


@router.get("/cards/{cid}/raw")
def card_raw(cid: int, uc: UserCollection = Depends(current_user)) -> dict:
    """The card's scheduling fields, for AnkiDroid's JS API (ankiGetCardReps etc.)."""
    with uc.use() as col:
        c = col.get_card(cid)
        return {
            "reps": c.reps, "ivl": c.ivl, "factor": c.factor, "mod": c.mod, "type": c.type,
            "did": c.did, "left": c.left, "odid": c.odid, "odue": c.odue, "queue": c.queue,
            "lapses": c.lapses, "due": c.due, "nid": c.nid, "id": c.id,
        }


@router.get("/cards/{cid}/render")
def render_card(cid: int, browser: bool = False, uc: UserCollection = Depends(current_user)) -> dict:
    """Both sides of a card, as the previewer shows them."""
    with uc.use() as col:
        card: Card = col.get_card(cid)
        hide_play = col.get_config_bool(Config.Bool.HIDE_AUDIO_PLAY_BUTTONS)
        q = prepare(col, card.question(reload=True, browser=browser), hide_play)
        a = prepare(col, card.answer(), hide_play)
        from ..render import TYPE_ANS_PAT

        return {
            "id": card.id,
            "noteId": card.nid,
            "question": TYPE_ANS_PAT.sub("", q),
            "answer": TYPE_ANS_PAT.sub("", a),
            "questionAv": av_tags(card.question_av_tags()),
            "answerAv": av_tags(card.answer_av_tags()),
            "bodyClass": body_class(card),
            "flag": card.user_flag(),
            "marked": card.note().has_tag("marked"),
        }
