"""The card browser: search, its columns and sort order, cards or notes, saved searches.

Rows come from the backend as desktop's browser table gets them (browser_row_for_id),
so every column, colour and sort is Anki's own.
"""

from __future__ import annotations

from anki.config import Config
from anki.search_pb2 import BrowserRow, SearchNode
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection

router = APIRouter(prefix="/api/browse")

COLORS = {
    BrowserRow.COLOR_DEFAULT: None,
    BrowserRow.COLOR_MARKED: "marked",
    BrowserRow.COLOR_SUSPENDED: "suspended",
    BrowserRow.COLOR_BURIED: "buried",
    BrowserRow.COLOR_FLAG_RED: "flag1",
    BrowserRow.COLOR_FLAG_ORANGE: "flag2",
    BrowserRow.COLOR_FLAG_GREEN: "flag3",
    BrowserRow.COLOR_FLAG_BLUE: "flag4",
    BrowserRow.COLOR_FLAG_PINK: "flag5",
    BrowserRow.COLOR_FLAG_TURQUOISE: "flag6",
    BrowserRow.COLOR_FLAG_PURPLE: "flag7",
}


def _notes_mode(col) -> bool:
    return col.get_config_bool(Config.Bool.BROWSER_TABLE_SHOW_NOTES_MODE)


def _active(col, notes: bool) -> list[str]:
    return col.load_browser_note_columns() if notes else col.load_browser_card_columns()


@router.get("/config")
def browse_config(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        notes = _notes_mode(col)
        sort_key = col.get_config("noteSortType" if notes else "sortType", "noteFld")
        reverse = col.get_config("browserNoteSortBackwards" if notes else "sortBackwards", False)
        return {
            "notesMode": notes,
            "columns": [
                {
                    "key": c.key,
                    "label": c.notes_mode_label if notes else c.cards_mode_label,
                    "sortable": (c.sorting_notes if notes else c.sorting_cards) != 0,
                    "tooltip": c.notes_mode_tooltip if notes else c.cards_mode_tooltip,
                }
                for c in col.all_browser_columns()
            ],
            "active": _active(col, notes),
            "sortColumn": sort_key,
            "sortReverse": reverse,
            "defaultSearch": col.get_config_string(Config.String.DEFAULT_SEARCH_TEXT) or "deck:current",
            "savedSearches": col.get_config("savedFilters", {}) or {},
        }


class Mode(BaseModel):
    notesMode: bool


@router.post("/mode")
def set_mode(body: Mode, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.set_config_bool(Config.Bool.BROWSER_TABLE_SHOW_NOTES_MODE, body.notesMode)
        return {"ok": True}


class Columns(BaseModel):
    columns: list[str]


@router.post("/columns")
def set_columns(body: Columns, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        if not body.columns:
            raise HTTPException(400, "Keep at least one column.")
        if _notes_mode(col):
            col.set_browser_note_columns(body.columns)
        else:
            col.set_browser_card_columns(body.columns)
        return {"ok": True}


class Sort(BaseModel):
    column: str
    reverse: bool


@router.post("/sort")
def set_sort(body: Sort, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        if _notes_mode(col):
            col.set_config("noteSortType", body.column)
            col.set_config("browserNoteSortBackwards", body.reverse)
        else:
            col.set_config("sortType", body.column)
            col.set_config("sortBackwards", body.reverse)
        return {"ok": True}


class Search(BaseModel):
    search: str


@router.post("/search")
def search(body: Search, uc: UserCollection = Depends(current_user)) -> dict:
    """Ids of the matching cards (or notes, in notes mode), in the browser's sort order."""
    with uc.use() as col:
        notes = _notes_mode(col)
        key = col.get_config("noteSortType" if notes else "sortType", "noteFld")
        reverse = col.get_config("browserNoteSortBackwards" if notes else "sortBackwards", False)
        column = col.get_browser_column(key)
        sortable = column and (column.sorting_notes if notes else column.sorting_cards) != 0
        order = column if sortable else False
        try:
            ids = (col.find_notes if notes else col.find_cards)(body.search, order=order, reverse=reverse)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return {"ids": list(ids), "notesMode": notes}


class Rows(BaseModel):
    ids: list[int]


@router.post("/rows")
def rows(body: Rows, uc: UserCollection = Depends(current_user)) -> list[dict]:
    with uc.use() as col:
        _active(col, _notes_mode(col))
        out = []
        for i in body.ids[:500]:
            try:
                cells, color, _font, _size = col.browser_row_for_id(i)
                out.append({"id": i, "cells": [c[0] for c in cells], "color": COLORS.get(color)})
            except Exception:
                out.append({"id": i, "cells": [], "color": None, "missing": True})
        return out


class Ids(BaseModel):
    ids: list[int]
    notesMode: bool


@router.post("/to-cards")
def to_cards(body: Ids, uc: UserCollection = Depends(current_user)) -> dict:
    """Card ids and note ids for a selection, whichever mode it was made in."""
    with uc.use() as col:
        if body.notesMode:
            cids: list[int] = []
            for nid in body.ids:
                cids.extend(col.card_ids_of_note(nid))
            return {"cardIds": cids, "noteIds": body.ids}
        nids = list(dict.fromkeys(col.get_card(c).nid for c in body.ids))
        return {"cardIds": body.ids, "noteIds": nids}


@router.post("/search-node")
async def search_node(request: Request, uc: UserCollection = Depends(current_user)) -> dict:
    """A SearchNode from one of Anki's pages, as the search text the browser shows."""
    node = SearchNode()
    node.ParseFromString(await request.body())
    with uc.use() as col:
        return {"search": col.build_search_string(node)}


class Saved(BaseModel):
    name: str
    search: str | None = None


@router.post("/saved")
def save_search(body: Saved, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        saved = dict(col.get_config("savedFilters", {}) or {})
        if body.search is None:
            saved.pop(body.name, None)
        else:
            saved[body.name] = body.search
        col.set_config("savedFilters", saved)
        return {"savedSearches": saved}
