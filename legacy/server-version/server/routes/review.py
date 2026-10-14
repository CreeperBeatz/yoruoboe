"""The study screen: the next card, its answer, and answering it.

As desktop's reviewer does, the scheduling states of the card on screen are kept
between requests (uc.session["review"]); the deck's custom scheduling JavaScript may
change them through /_anki/setSchedulingStates before the card is answered.
"""

from __future__ import annotations

import secrets
import time

from anki.cards import Card
from anki.config import Config
from anki.scheduler_pb2 import CardAnswer
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection
from ..render import (
    TypeAnswer,
    av_tags,
    body_class,
    deck_conf_for_card,
    prepare,
    type_answer_answer,
    type_answer_question,
)

router = APIRouter(prefix="/api/review")

QUEUE_NAMES = {0: "new", 1: "learn", 2: "review"}


def _counts(out) -> dict:
    return {"new": out.new_count, "learn": out.learning_count, "review": out.review_count}


def _undo(col) -> dict:
    s = col.undo_status()
    return {"undo": s.undo, "redo": s.redo}


def _next_card(uc: UserCollection, col) -> dict:
    out = col.sched.get_queued_cards(fetch_limit=2)
    if not out.cards:
        uc.session.pop("review", None)
        info = col.sched.congratulations_info()
        return {
            "finished": True,
            "deckId": col.decks.get_current_id(),
            "congrats": {
                "learnRemaining": info.learn_remaining,
                "secsUntilNextLearn": info.secs_until_next_learn,
                "reviewRemaining": info.review_remaining,
                "newRemaining": info.new_remaining,
                "haveSchedBuried": info.have_sched_buried,
                "haveUserBuried": info.have_user_buried,
                "isFilteredDeck": info.is_filtered_deck,
                "deckDescription": info.deck_description,
            },
            "undo": _undo(col),
        }
    top = out.cards[0]
    card = Card(col, backend_card=top.card)
    card.start_timer()
    states = top.states
    states.current.custom_data = top.card.custom_data

    hide_play = col.get_config_bool(Config.Bool.HIDE_AUDIO_PLAY_BUTTONS)
    q_raw = card.question(reload=True)
    q, ta = type_answer_question(card, col, prepare(col, q_raw, hide_play))
    # The answer, without typing, so the frame can preload its images.
    a_preload = col.media.escape_media_filenames(card.answer())

    previous = uc.session.get("review") or {}
    key = previous.get("key") or secrets.token_hex(8)
    uc.session["review"] = {
        "key": key,
        "card": card,
        "states": states,
        "context": top.context,
        "queue": top.queue,
        "type": ta,
        "shown_at": time.time(),
    }
    note = card.note()
    siblings = len(note.card_ids()) > 1
    upcoming = out.cards[1].card.id if len(out.cards) > 1 else None
    return {
        "finished": False,
        "key": key,
        "card": {
            "id": card.id,
            "noteId": card.nid,
            "mod": card.mod,
            "ord": card.ord,
            "deckId": card.current_deck_id(),
            "deckName": col.decks.name(card.current_deck_id()),
            "queue": QUEUE_NAMES.get(top.queue, "new"),
            "flag": card.user_flag(),
            "marked": note.has_tag("marked"),
            "hasSiblings": siblings,
            "bodyClass": body_class(card),
            "question": q,
            "answerPreload": a_preload,
            "questionAv": av_tags(card.question_av_tags()),
            "hasTypeAnswer": ta.found and bool(ta.correct),
            "timeLimitSecs": card.time_limit() // 1000,
        },
        "nextCardId": upcoming,
        "counts": _counts(out),
        "deckConf": deck_conf_for_card(col, card),
        "showRemaining": bool(col.get_config("dueCounts", True)),
        "showIntervals": bool(col.get_config("estTimes", True)),
        "customScheduling": col.get_config("cardStateCustomizer", "") or "",
        "undo": _undo(col),
    }


@router.get("/next")
def next_card(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return _next_card(uc, col)


class ShowAnswer(BaseModel):
    cardId: int
    typed: str = ""


@router.post("/answer-side")
def answer_side(body: ShowAnswer, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        current = uc.session.get("review")
        if not current or current["card"].id != body.cardId:
            raise HTTPException(409, "This card is no longer being studied.")
        card: Card = current["card"]
        hide_play = col.get_config_bool(Config.Bool.HIDE_AUDIO_PLAY_BUTTONS)
        ta: TypeAnswer = current["type"]
        a = type_answer_answer(col, prepare(col, card.answer(), hide_play), ta, body.typed)
        labels = list(col.sched.describe_next_states(current["states"]))
        return {
            "answer": a,
            "answerAv": av_tags(card.answer_av_tags()),
            "questionAv": av_tags(card.question_av_tags()),
            "labels": labels,
        }


class Answer(BaseModel):
    cardId: int
    # 1 again, 2 hard, 3 good, 4 easy
    ease: int
    # As measured on the device; the backend caps it at the deck's limit.
    millis: int | None = None


@router.post("/answer")
def answer(body: Answer, uc: UserCollection = Depends(current_user)) -> dict:
    if body.ease not in (1, 2, 3, 4):
        raise HTTPException(400, "ease must be 1-4")
    with uc.use() as col:
        current = uc.session.get("review")
        if not current or current["card"].id != body.cardId:
            raise HTTPException(409, "This card is no longer being studied.")
        card: Card = current["card"]
        states = current["states"]
        rating = (CardAnswer.AGAIN, CardAnswer.HARD, CardAnswer.GOOD, CardAnswer.EASY)[body.ease - 1]
        ans = col.sched.build_answer(card=card, states=states, rating=rating)
        if body.millis is not None:
            ans.milliseconds_taken = max(0, body.millis)
        try:
            col.sched.answer_card(ans)
        except Exception as exc:
            # Changed meanwhile (a sync, another device): show what is due now instead.
            uc.session.pop("review", None)
            return {"error": str(exc), "next": _next_card(uc, col)}
        leech = col.sched.state_is_leech(ans.new_state)
        if leech:
            card.load()
        return {
            "leech": leech,
            "leechSuspended": leech and card.queue == -1,
            "next": _next_card(uc, col),
        }


@router.post("/time-box")
def time_box(uc: UserCollection = Depends(current_user)) -> dict:
    """The collection's time limit: how long and how many cards since the session began."""
    with uc.use() as col:
        limit = col.conf.get("timeLim", 0)
        return {"limitSecs": limit}
