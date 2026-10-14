"""The deck list, a deck's study overview, and what can be done to decks."""

from __future__ import annotations

from anki.decks import DeckId
from anki.scheduler_pb2 import CustomStudyRequest
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection

router = APIRouter(prefix="/api/decks")


def _node(n) -> dict:
    return {
        "id": n.deck_id,
        "name": n.name,
        "level": n.level,
        "collapsed": n.collapsed,
        "filtered": n.filtered,
        "new": n.new_count,
        "learn": n.learn_count,
        "review": n.review_count,
        "total": n.total_including_children,
        "children": [_node(c) for c in n.children],
    }


def undo_info(col) -> dict:
    s = col.undo_status()
    return {"undo": s.undo, "redo": s.redo}


@router.get("")
def deck_list(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        tree = col.sched.deck_due_tree()
        return {
            "decks": [_node(c) for c in tree.children],
            "current": col.decks.get_current_id(),
            "studiedToday": col.studied_today(),
            "undo": undo_info(col),
            "cardCount": col.card_count(),
        }


class NewDeck(BaseModel):
    name: str


@router.post("")
def add_deck(body: NewDeck, uc: UserCollection = Depends(current_user)) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "A deck needs a name.")
    with uc.use() as col:
        if col.decks.id_for_name(name):
            raise HTTPException(409, "A deck with that name already exists.")
        out = col.decks.add_normal_deck_with_name(name)
        return {"id": out.id}


@router.get("/{did}")
def overview(did: int, uc: UserCollection = Depends(current_user)) -> dict:
    """What the study screen shows before the first card (AnkiDroid's StudyOptionsFragment)."""
    with uc.use() as col:
        deck = col.decks.get(DeckId(did), default=False)
        if deck is None:
            raise HTTPException(404, "No such deck.")
        col.decks.select(DeckId(did))
        node = col.sched.deck_due_tree(DeckId(did))
        congrats = col.sched.congratulations_info()
        new, learn, review = col.sched.counts()
        return {
            "id": did,
            "name": deck["name"],
            "filtered": bool(deck["dyn"]),
            "description": deck.get("desc", ""),
            "markdownDescription": bool(deck.get("md", False)),
            "counts": {"new": new, "learn": learn, "review": review},
            "total": node.total_including_children if node else 0,
            "buried": {"sched": congrats.have_sched_buried, "user": congrats.have_user_buried},
            "finished": new + learn + review == 0,
            "secsUntilNextLearn": congrats.secs_until_next_learn,
            "undo": undo_info(col),
        }


class Rename(BaseModel):
    name: str


@router.post("/{did}/rename")
def rename(did: int, body: Rename, uc: UserCollection = Depends(current_user)) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "A deck needs a name.")
    with uc.use() as col:
        existing = col.decks.id_for_name(name)
        if existing and existing != did:
            raise HTTPException(409, "A deck with that name already exists.")
        col.decks.rename(DeckId(did), name)
        return {"ok": True}


class Reparent(BaseModel):
    # 0 makes the decks top-level
    parent: int


@router.post("/{did}/reparent")
def reparent(did: int, body: Reparent, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.decks.reparent([DeckId(did)], DeckId(body.parent))
        return {"ok": True}


@router.delete("/{did}")
def delete(did: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.decks.remove([DeckId(did)])
        return {"removedCards": out.count, "undo": undo_info(col)}


class Collapse(BaseModel):
    collapsed: bool


@router.post("/{did}/collapse")
def collapse(did: int, body: Collapse, uc: UserCollection = Depends(current_user)) -> dict:
    from anki.decks_pb2 import SetDeckCollapsedRequest

    with uc.use() as col:
        col.decks.set_collapsed(
            deck_id=DeckId(did), collapsed=body.collapsed, scope=SetDeckCollapsedRequest.REVIEWER
        )
        return {"ok": True}


class Unbury(BaseModel):
    # "all", "sched" (buried siblings) or "user" (buried by hand)
    mode: str = "all"


@router.post("/{did}/unbury")
def unbury(did: int, body: Unbury, uc: UserCollection = Depends(current_user)) -> dict:
    from anki.scheduler_pb2 import UnburyDeckRequest

    mode = {
        "all": UnburyDeckRequest.ALL,
        "sched": UnburyDeckRequest.SCHED_ONLY,
        "user": UnburyDeckRequest.USER_ONLY,
    }.get(body.mode)
    if mode is None:
        raise HTTPException(400, "mode must be all, sched or user")
    with uc.use() as col:
        col.sched.unbury_deck(DeckId(did), mode)
        return {"ok": True}


class Description(BaseModel):
    description: str
    markdown: bool = False


@router.post("/{did}/description")
def set_description(did: int, body: Description, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        deck = col.decks.get(DeckId(did))
        deck["desc"] = body.description
        deck["md"] = body.markdown
        col.decks.update_dict(deck)
        return {"ok": True}


# ---- filtered decks -------------------------------------------------------------


@router.post("/{did}/rebuild")
def rebuild(did: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.sched.rebuild_filtered_deck(DeckId(did))
        return {"count": out.count}


@router.post("/{did}/empty")
def empty(did: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.sched.empty_filtered_deck(DeckId(did))
        return {"ok": True}


@router.get("/filtered/{did}")
def get_filtered(did: int, search: str | None = None, uc: UserCollection = Depends(current_user)) -> dict:
    """A filtered deck's settings; did 0 gives the defaults for a new one."""
    with uc.use() as col:
        f = col.sched.get_or_create_filtered_deck(DeckId(did))
        c = f.config
        terms = [{"search": t.search, "limit": t.limit, "order": t.order} for t in c.search_terms]
        if did == 0 and search is not None and terms:
            terms[0]["search"] = search
        return {
            "id": f.id,
            "name": f.name,
            "reschedule": c.reschedule,
            "terms": terms,
            "delays": list(c.delays),
            "previewAgainSecs": c.preview_again_secs,
            "previewHardSecs": c.preview_hard_secs,
            "previewGoodSecs": c.preview_good_secs,
            "allowEmpty": f.allow_empty,
            "orderLabels": list(col.sched.filtered_deck_order_labels()),
        }


class FilteredTerm(BaseModel):
    search: str
    limit: int
    order: int


class FilteredDeck(BaseModel):
    id: int
    name: str
    reschedule: bool
    terms: list[FilteredTerm]
    delays: list[float] = []
    previewAgainSecs: int = 60
    previewHardSecs: int = 600
    previewGoodSecs: int = 0


@router.post("/filtered")
def save_filtered(body: FilteredDeck, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        f = col.sched.get_or_create_filtered_deck(DeckId(body.id))
        f.name = body.name
        c = f.config
        c.reschedule = body.reschedule
        del c.search_terms[:]
        for t in body.terms:
            if t.search.strip() or not c.search_terms:
                c.search_terms.add(search=t.search, limit=t.limit, order=t.order)
        del c.delays[:]
        c.delays.extend(body.delays)
        c.preview_again_secs = body.previewAgainSecs
        c.preview_hard_secs = body.previewHardSecs
        c.preview_good_secs = body.previewGoodSecs
        try:
            out = col.sched.add_or_update_filtered_deck(f)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        col.decks.select(DeckId(out.id))
        return {"id": out.id}


# ---- custom study ---------------------------------------------------------------


@router.get("/{did}/custom-study")
def custom_study_defaults(did: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        d = col.sched.custom_study_defaults(DeckId(did))
        return {
            "tags": [{"name": t.name, "include": t.include, "exclude": t.exclude} for t in d.tags],
            "extendNew": d.extend_new,
            "extendReview": d.extend_review,
            "availableNew": d.available_new,
            "availableReview": d.available_review,
            "availableNewInChildren": d.available_new_in_children,
            "availableReviewInChildren": d.available_review_in_children,
        }


class CustomStudy(BaseModel):
    # newLimit | reviewLimit | forgot | ahead | preview | cram
    kind: str
    value: int = 0
    # cram only
    cramKind: str = "new"  # new | due | review | all
    cramLimit: int = 100
    tagsToInclude: list[str] = []
    tagsToExclude: list[str] = []


@router.post("/{did}/custom-study")
def custom_study(did: int, body: CustomStudy, uc: UserCollection = Depends(current_user)) -> dict:
    req = CustomStudyRequest(deck_id=did)
    if body.kind == "newLimit":
        req.new_limit_delta = body.value
    elif body.kind == "reviewLimit":
        req.review_limit_delta = body.value
    elif body.kind == "forgot":
        req.forgot_days = body.value
    elif body.kind == "ahead":
        req.review_ahead_days = body.value
    elif body.kind == "preview":
        req.preview_days = body.value
    elif body.kind == "cram":
        kinds = {
            "new": CustomStudyRequest.Cram.CRAM_KIND_NEW,
            "due": CustomStudyRequest.Cram.CRAM_KIND_DUE,
            "review": CustomStudyRequest.Cram.CRAM_KIND_REVIEW,
            "all": CustomStudyRequest.Cram.CRAM_KIND_ALL,
        }
        req.cram.kind = kinds[body.cramKind]
        req.cram.card_limit = body.cramLimit
        req.cram.tags_to_include.extend(body.tagsToInclude)
        req.cram.tags_to_exclude.extend(body.tagsToExclude)
    else:
        raise HTTPException(400, "unknown custom study kind")
    with uc.use() as col:
        try:
            col.sched.custom_study(req)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return {"current": col.decks.get_current_id()}
