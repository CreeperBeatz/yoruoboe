"""Studying without a connection.

The collection lives on the server, so the app takes a pack with it: for every deck
with cards due, the cards it would show next, rendered, with what the answer buttons
would do. Offline, the app shows those cards and keeps the answers; back online it
sends them here and they are applied in order, each against the card's state at that
moment (the scheduler recomputes it), then synced like any other review.
"""

from __future__ import annotations

import time

from anki.cards import Card
from anki.config import Config
from anki.decks import DeckId
from anki.scheduler_pb2 import CardAnswer, SchedulingState
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection
from ..render import TYPE_ANS_PAT, av_tags, body_class, deck_conf_for_card, prepare, type_answer_question
from .decks import _node

router = APIRouter(prefix="/api/offline")

TYPE_PLACEHOLDER = "%%TYPEANS%%"
QUEUE_NAMES = {0: "new", 1: "learn", 2: "review"}


def _requeue_secs(state: SchedulingState) -> int | None:
    """Seconds until the card comes back today, if this answer keeps it in learning."""
    normal = state.normal if state.HasField("normal") else (
        state.filtered.rescheduling.original_state if state.HasField("filtered") and state.filtered.HasField("rescheduling") else None
    )
    if normal is None:
        if state.HasField("filtered") and state.filtered.HasField("preview"):
            secs = state.filtered.preview.scheduled_secs
            return secs if not state.filtered.preview.finished else None
        return None
    kind = normal.WhichOneof("kind")
    if kind == "learning":
        return normal.learning.scheduled_secs
    if kind == "relearning":
        return normal.relearning.learning.scheduled_secs
    return None


def _render(col, card: Card, states, queue: int, hide_play: bool) -> dict:
    q, ta = type_answer_question(card, col, prepare(col, card.question(reload=True), hide_play))
    answer = prepare(col, card.answer(), hide_play)
    if ta.correct:
        answer = TYPE_ANS_PAT.sub(TYPE_PLACEHOLDER, answer)
    else:
        answer = TYPE_ANS_PAT.sub("", answer)
    note = card.note()
    order = (states.again, states.hard, states.good, states.easy)
    text = q + answer
    return {
        "id": card.id,
        "noteId": card.nid,
        "deckId": card.current_deck_id(),
        "deckName": col.decks.name(card.current_deck_id()),
        "mod": card.mod,
        "queue": QUEUE_NAMES.get(queue, "new"),
        "flag": card.user_flag(),
        "marked": note.has_tag("marked"),
        "bodyClass": body_class(card),
        "question": q,
        "answer": answer,
        "answerPreload": col.media.escape_media_filenames(card.answer()),
        "questionAv": av_tags(card.question_av_tags()),
        "answerAv": av_tags(card.answer_av_tags()),
        "typeAnswer": {"correct": ta.correct, "font": ta.font, "size": ta.size} if ta.correct else None,
        "labels": list(col.sched.describe_next_states(states)),
        "requeueSecs": [_requeue_secs(s) for s in order],
        "deckConf": deck_conf_for_card(col, card),
        "media": sorted(set(col.media.files_in_str(note.mid, text))),
    }


@router.get("/pack")
def pack(per_deck: int = 200, uc: UserCollection = Depends(current_user)) -> dict:
    per_deck = max(1, min(per_deck, 1000))
    with uc.use() as col:
        tree = col.sched.deck_due_tree()
        decks = [_node(c) for c in tree.children]
        due_decks: list[int] = []

        def walk(nodes):
            for n in nodes:
                if n.new_count + n.learn_count + n.review_count > 0:
                    due_decks.append(n.deck_id)
                walk(n.children)

        walk(tree.children)
        hide_play = col.get_config_bool(Config.Bool.HIDE_AUDIO_PLAY_BUTTONS)
        current = col.decks.get_current_id()
        cards: dict[int, dict] = {}
        queues: dict[int, list[int]] = {}
        try:
            for did in due_decks:
                col.decks.select(DeckId(did))
                out = col.sched.get_queued_cards(fetch_limit=per_deck)
                ids = []
                for qc in out.cards:
                    cid = qc.card.id
                    ids.append(cid)
                    if cid not in cards:
                        card = Card(col, backend_card=qc.card)
                        states = qc.states
                        cards[cid] = _render(col, card, states, qc.queue, hide_play)
                queues[did] = ids
        finally:
            # Studying must go on with the deck the user chose.
            col.decks.select(DeckId(current))
        media = sorted({m for c in cards.values() for m in c["media"]})
        return {
            "generatedAt": time.time(),
            "decks": decks,
            "studiedToday": col.studied_today(),
            "queues": {str(k): v for k, v in queues.items()},
            "cards": {str(k): v for k, v in cards.items()},
            "media": media,
            "showIntervals": bool(col.get_config("estTimes", True)),
        }


class Op(BaseModel):
    type: str
    cardId: int | None = None
    noteId: int | None = None
    ease: int | None = None
    answeredAt: int | None = None  # ms
    millis: int | None = None
    # The card's modification time when it was packed: if it has changed since (studied
    # on another device), the offline answer is out of date and skipped.
    cardMod: int | None = None
    flag: int | None = None
    marked: bool | None = None


class Ops(BaseModel):
    ops: list[Op]


RATINGS = (CardAnswer.AGAIN, CardAnswer.HARD, CardAnswer.GOOD, CardAnswer.EASY)


@router.post("/replay")
def replay(body: Ops, uc: UserCollection = Depends(current_user)) -> dict:
    """Apply what was done offline, oldest first. A card changed elsewhere after it
    was answered here (say, studied on desktop meanwhile) keeps that newer state."""
    applied = skipped = 0
    errors: list[str] = []
    # Cards this replay has answered: a card answered twice offline (Again, then Good)
    # has changed since packing because of the first answer, which is fine.
    replayed: set[int] = set()
    with uc.use() as col:
        for op in body.ops:
            try:
                if op.type == "answer":
                    card = col.get_card(op.cardId)
                    if op.cardMod is not None and card.id not in replayed and card.mod != op.cardMod:
                        skipped += 1
                        continue
                    replayed.add(card.id)
                    states = col._backend.get_scheduling_states(card.id)
                    rating = RATINGS[(op.ease or 3) - 1]
                    new_state = (states.again, states.hard, states.good, states.easy)[(op.ease or 3) - 1]
                    col.sched.answer_card(
                        CardAnswer(
                            card_id=card.id,
                            current_state=states.current,
                            new_state=new_state,
                            rating=rating,
                            answered_at_millis=op.answeredAt or int(time.time() * 1000),
                            milliseconds_taken=max(0, op.millis or 0),
                        )
                    )
                elif op.type == "flag":
                    col.set_user_flag_for_cards(op.flag or 0, [op.cardId])
                    replayed.add(op.cardId)
                elif op.type == "mark":
                    if op.marked:
                        col.tags.bulk_add([op.noteId], "marked")
                    else:
                        col.tags.bulk_remove([op.noteId], "marked")
                elif op.type == "buryCard":
                    col.sched.bury_cards([op.cardId], manual=True)
                    replayed.add(op.cardId)
                elif op.type == "suspendCard":
                    col.sched.suspend_cards([op.cardId])
                    replayed.add(op.cardId)
                else:
                    skipped += 1
                    continue
                applied += 1
            except Exception as exc:
                # A card deleted elsewhere meanwhile: nothing to apply it to.
                skipped += 1
                errors.append(f"{op.type} {op.cardId}: {exc}")
        uc.session.pop("review", None)
    return {"applied": applied, "skipped": skipped, "errors": errors[:20]}
