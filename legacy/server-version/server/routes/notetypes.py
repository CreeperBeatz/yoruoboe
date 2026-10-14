"""Notes and note types: a note's details, managing note types, their fields and card
templates (AnkiDroid's ManageNotetypes, ModelFieldEditor and CardTemplateEditor)."""

from __future__ import annotations

import copy

from anki.config import Config
from anki.notes import Note
from anki.notetypes_pb2 import StockNotetype
from anki.stdmodels import get_stock_notetypes
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection
from ..render import av_tags, prepare

router = APIRouter(prefix="/api")

IO_KIND = StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION


# ---- notes ------------------------------------------------------------------------------


@router.get("/notes/{nid}")
def note_meta(nid: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        try:
            note = col.get_note(nid)
        except Exception:
            raise HTTPException(404, "No such note.")
        return {"id": note.id, "notetypeId": note.mid, "cardIds": list(note.card_ids()), "tags": list(note.tags)}


class NoteIds(BaseModel):
    noteIds: list[int]


@router.post("/notes/change-notetype-start")
def change_notetype_start(body: NoteIds, uc: UserCollection = Depends(current_user)) -> dict:
    """Remember which notes the Change Note Type page is for (it doesn't say)."""
    with uc.use() as col:
        mids = {col.get_note(n).mid for n in body.noteIds}
        if len(mids) != 1:
            raise HTTPException(400, "Please select notes from only one note type.")
        uc.session["change_notetype_nids"] = list(body.noteIds)
        return {"notetypeId": mids.pop()}


# ---- note types ---------------------------------------------------------------------------


@router.get("/notetypes")
def notetypes(uc: UserCollection = Depends(current_user)) -> list[dict]:
    with uc.use() as col:
        out = []
        for n in col.models.all_use_counts():
            nt = col.models.get(n.id)
            out.append({
                "id": n.id,
                "name": n.name,
                "useCount": n.use_count,
                "cloze": nt["type"] == 1,
                "io": nt.get("originalStockKind") == IO_KIND,
                "fields": [f["name"] for f in nt["flds"]],
                "templates": [t["name"] for t in nt["tmpls"]],
            })
        return out


@router.get("/notetypes/stock")
def stock_notetypes(uc: UserCollection = Depends(current_user)) -> list[dict]:
    with uc.use() as col:
        stock = [{"key": f"stock:{i}", "name": f"Add: {name}"} for i, (name, _) in enumerate(get_stock_notetypes(col))]
        clones = [{"key": f"clone:{n.id}", "name": f"Clone: {n.name}"} for n in col.models.all_names_and_ids()]
        return stock + clones


class NewNotetype(BaseModel):
    key: str
    name: str


@router.post("/notetypes")
def add_notetype(body: NewNotetype, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        kind, _, ref = body.key.partition(":")
        if kind == "stock":
            nt = get_stock_notetypes(col)[int(ref)][1](col)
            nt = copy.deepcopy(nt)
        elif kind == "clone":
            nt = col.models.copy(col.models.get(int(ref)), add=False)
        else:
            raise HTTPException(400, "unknown kind")
        nt["name"] = body.name.strip() or nt["name"]
        nt["id"] = 0
        out = col.models.add_dict(nt)
        return {"id": out.id}


@router.get("/notetypes/image-occlusion")
def io_notetype(uc: UserCollection = Depends(current_user)) -> dict:
    """The image occlusion note type, created if the collection has none yet."""
    with uc.use() as col:
        for n in col.models.all_names_and_ids():
            if col.models.get(n.id).get("originalStockKind") == IO_KIND:
                return {"id": n.id}
        col._backend.add_image_occlusion_notetype()
        for n in col.models.all_names_and_ids():
            if col.models.get(n.id).get("originalStockKind") == IO_KIND:
                return {"id": n.id}
        raise HTTPException(500, "Could not create the image occlusion note type.")


class Rename(BaseModel):
    name: str


@router.post("/notetypes/{ntid}/rename")
def rename_notetype(ntid: int, body: Rename, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        nt = col.models.get(ntid)
        nt["name"] = body.name.strip()
        col.models.ensure_name_unique(nt)
        col.models.update_dict(nt)
        return {"ok": True}


@router.delete("/notetypes/{ntid}")
def delete_notetype(ntid: int, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        if len(col.models.all_names_and_ids()) <= 1:
            raise HTTPException(400, "The last note type can't be deleted.")
        col.models.remove(ntid)
        return {"ok": True}


@router.get("/notetypes/{ntid}")
def get_notetype(ntid: int, uc: UserCollection = Depends(current_user)) -> dict:
    """The whole note type, as the legacy dict desktop's dialogs edit."""
    with uc.use() as col:
        nt = col.models.get(ntid)
        if nt is None:
            raise HTTPException(404, "No such note type.")
        return {
            "notetype": nt,
            "useCount": col.models.use_count(nt),
            "templateUseCounts": [col.models.template_use_count(ntid, i) for i in range(len(nt["tmpls"]))],
        }


class SaveNotetype(BaseModel):
    notetype: dict


@router.post("/notetypes/{ntid}/save")
def save_notetype(ntid: int, body: SaveNotetype, uc: UserCollection = Depends(current_user)) -> dict:
    """Save an edited note type: fields, templates, styling.

    Field and template changes alter the schema; the next sync then has to be a full
    one, as on desktop and AnkiDroid, which ask first (the app does).
    """
    nt = body.notetype
    if nt.get("id") != ntid:
        raise HTTPException(400, "id mismatch")
    with uc.use() as col:
        try:
            col.models.update_dict(nt)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True}


@router.get("/notetypes/{ntid}/new-field")
def new_field(ntid: int, name: str, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return col.models.new_field(name)


@router.get("/notetypes/{ntid}/new-template")
def new_template(ntid: int, name: str, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return col.models.new_template(name)


@router.get("/schema-change-needs-full-sync")
def schema_change_needs_full_sync(uc: UserCollection = Depends(current_user)) -> dict:
    """Whether a schema change would force a one-way sync (it won't if one is pending)."""
    with uc.use() as col:
        return {"needed": not col.schema_changed()}


# ---- card template preview ----------------------------------------------------------------


class Preview(BaseModel):
    notetype: dict
    ord: int = 0
    noteId: int | None = None
    fillEmpty: bool = True


@router.post("/notetypes/preview")
def preview(body: Preview, uc: UserCollection = Depends(current_user)) -> dict:
    """Render an unsaved note type's template: with a note, or with the field names."""
    with uc.use() as col:
        nt = body.notetype
        if body.noteId:
            note = col.get_note(body.noteId)
            if note.mid != nt["id"]:
                note = None
        else:
            note = None
        if note is None:
            note = Note(col, nt)
            for i, f in enumerate(nt["flds"]):
                note.fields[i] = "{{c1::" + f["name"] + "}}" if nt["type"] == 1 and i == 0 else f"({f['name']})"
        is_cloze = nt["type"] == 1
        template = nt["tmpls"][0 if is_cloze else body.ord]
        card = note.ephemeral_card(
            body.ord, custom_note_type=nt, custom_template=template, fill_empty=body.fillEmpty
        )
        hide = col.get_config_bool(Config.Bool.HIDE_AUDIO_PLAY_BUTTONS)
        # The ephemeral card is rendered already; reloading would look for it in the database.
        q = prepare(col, card.question(), hide)
        a = prepare(col, card.answer(), hide)
        from ..render import TYPE_ANS_PAT

        return {
            "question": TYPE_ANS_PAT.sub("", q),
            "answer": TYPE_ANS_PAT.sub("", a),
            "bodyClass": f"card card{body.ord + 1}",
            "questionAv": av_tags(card.question_av_tags()),
            "answerAv": av_tags(card.answer_av_tags()),
        }
