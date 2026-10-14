"""Collection-wide tools: undo/redo, the checks, empty cards, backups, preferences,
import and export."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from anki.collection import CardIdsLimit, DeckIdLimit, NoteIdsLimit
from anki.import_export_pb2 import ExportAnkiPackageOptions
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..auth import current_user
from ..colman import UserCollection

router = APIRouter(prefix="/api")


def _undo(col) -> dict:
    s = col.undo_status()
    return {"undo": s.undo, "redo": s.redo}


# ---- undo / redo ----------------------------------------------------------------


@router.post("/undo")
def undo(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        status = col.undo_status()
        if not status.undo:
            raise HTTPException(409, "Nothing to undo.")
        col.undo()
        uc.session.pop("review", None)
        return {"name": status.undo, **_undo(col)}


@router.post("/redo")
def redo(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        status = col.undo_status()
        if not status.redo:
            raise HTTPException(409, "Nothing to redo.")
        col.redo()
        uc.session.pop("review", None)
        return {"name": status.redo, **_undo(col)}


@router.get("/undo")
def undo_status(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        return _undo(col)


@router.post("/abort")
def abort(uc: UserCollection = Depends(current_user)) -> dict:
    """Ask a long backend operation (import, optimizing) to stop. Takes no lock."""
    if uc.col is not None:
        uc.col.set_wants_abort()
    return {"ok": True}


# ---- checks ---------------------------------------------------------------------


@router.post("/check-database")
def check_database(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        problems, ok = col.fix_integrity()
        return {"report": problems, "ok": ok}


@router.post("/check-media")
def check_media(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        out = col.media.check()
        return {
            "report": out.report,
            "unused": list(out.unused),
            "missing": list(out.missing),
            "missingNotes": list(out.missing_media_notes),
            "haveTrash": out.have_trash,
        }


class Names(BaseModel):
    names: list[str]


@router.post("/media/trash-unused")
def trash_unused(body: Names, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.media.trash_files(body.names)
        return {"count": len(body.names)}


@router.post("/media/empty-trash")
def empty_trash(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.media.empty_trash()
        return {"ok": True}


@router.post("/media/restore-trash")
def restore_trash(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        col.media.restore_trash()
        return {"ok": True}


@router.get("/empty-cards")
def empty_cards(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        report = col.get_empty_cards()
        return {
            "report": report.report,
            "notes": [
                {"noteId": n.note_id, "cardIds": list(n.card_ids), "willDeleteNote": n.will_delete_note}
                for n in report.notes
            ],
        }


class EmptyCards(BaseModel):
    # Keep notes that would lose every card: delete all but their first card instead.
    keepNotes: bool = True


@router.post("/empty-cards")
def delete_empty_cards(body: EmptyCards, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        report = col.get_empty_cards()
        cids: list[int] = []
        for n in report.notes:
            ids = list(n.card_ids)
            if n.will_delete_note and body.keepNotes:
                ids = ids[1:]
            cids.extend(ids)
        col.remove_cards_and_orphaned_notes(cids)
        return {"count": len(cids)}


# ---- preferences (collection settings, synced) ------------------------------------


@router.get("/preferences")
def get_preferences(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        p = col.get_preferences()
        return {
            "scheduling": {
                "rollover": p.scheduling.rollover,
                "learnAheadSecs": p.scheduling.learn_ahead_secs,
                "newReviewMix": p.scheduling.new_review_mix,
                "dayLearnFirst": p.scheduling.day_learn_first,
            },
            "reviewing": {
                "hideAudioPlayButtons": p.reviewing.hide_audio_play_buttons,
                "interruptAudioWhenAnswering": p.reviewing.interrupt_audio_when_answering,
                "showRemainingDueCounts": p.reviewing.show_remaining_due_counts,
                "showIntervalsOnButtons": p.reviewing.show_intervals_on_buttons,
                "timeLimitSecs": p.reviewing.time_limit_secs,
                "loadBalancerEnabled": p.reviewing.load_balancer_enabled,
                "fsrsShortTermWithStepsEnabled": p.reviewing.fsrs_short_term_with_steps_enabled,
            },
            "editing": {
                "addingDefaultsToCurrentDeck": p.editing.adding_defaults_to_current_deck,
                "pasteImagesAsPng": p.editing.paste_images_as_png,
                "pasteStripsFormatting": p.editing.paste_strips_formatting,
                "defaultSearchText": p.editing.default_search_text,
                "ignoreAccentsInSearch": p.editing.ignore_accents_in_search,
                "renderLatex": p.editing.render_latex,
            },
            "backups": {
                "daily": p.backups.daily,
                "weekly": p.backups.weekly,
                "monthly": p.backups.monthly,
                "minimumIntervalMins": p.backups.minimum_interval_mins,
            },
        }


_SNAKE = re.compile(r"(?<!^)(?=[A-Z])")


@router.post("/preferences")
def set_preferences(body: dict, uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        p = col.get_preferences()
        for section, values in body.items():
            target = getattr(p, section, None)
            if target is None or not isinstance(values, dict):
                raise HTTPException(400, f"unknown section {section}")
            for key, value in values.items():
                name = _SNAKE.sub("_", key).lower()
                if not hasattr(target, name):
                    raise HTTPException(400, f"unknown setting {section}.{key}")
                setattr(target, name, value)
        col.set_preferences(p)
        return {"ok": True}


# ---- backups --------------------------------------------------------------------


def backup_dir(uc: UserCollection) -> Path:
    d = uc.dir / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/backups")
def create_backup(uc: UserCollection = Depends(current_user)) -> dict:
    with uc.use() as col:
        made = col.create_backup(backup_folder=str(backup_dir(uc)), force=True, wait_for_completion=True)
        return {"created": made}


@router.get("/backups")
def list_backups(uc: UserCollection = Depends(current_user)) -> list[dict]:
    files = sorted(backup_dir(uc).glob("*.colpkg"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"name": f.name, "time": f.stat().st_mtime, "size": f.stat().st_size} for f in files]


def _replace_collection(uc: UserCollection, package: Path) -> None:
    """Replace the collection with a .colpkg, then make the next sync upload it."""
    with uc.lock:
        uc.close()
        uc.dir.mkdir(parents=True, exist_ok=True)
        from anki.collection import Collection

        col = Collection(str(uc.col_path))
        media_dir = col.media.dir()
        media_db = str(uc.col_path.with_suffix("")) + ".media.db"
        col.close_for_full_sync()
        try:
            col._backend.import_collection_package(
                col_path=str(uc.col_path), backup_path=str(package), media_folder=media_dir, media_db=media_db
            )
        finally:
            col.reopen(after_full_sync=False)
            # A restored collection must replace the server's, not merge with it.
            col.set_schema_modified()
            col.close()
        uc.session.clear()


class Restore(BaseModel):
    name: str


@router.post("/backups/restore")
def restore_backup(body: Restore, uc: UserCollection = Depends(current_user)) -> dict:
    path = backup_dir(uc) / os.path.basename(body.name)
    if not path.is_file():
        raise HTTPException(404, "No such backup.")
    _replace_collection(uc, path)
    return {"ok": True}


# ---- import ---------------------------------------------------------------------


def upload_dir(uc: UserCollection) -> Path:
    d = uc.dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    # Old uploads are only needed while their import page is open.
    for f in d.iterdir():
        if time.time() - f.stat().st_mtime > 86400:
            f.unlink(missing_ok=True)
    return d


@router.post("/import/upload")
async def upload_for_import(file: UploadFile = File(...), uc: UserCollection = Depends(current_user)) -> dict:
    """Store an uploaded .apkg/.colpkg/.csv; the import page is then opened on its path."""
    name = os.path.basename(file.filename or "import")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ("apkg", "colpkg", "csv", "tsv", "txt"):
        raise HTTPException(400, "Choose an .apkg, .colpkg, .csv, .tsv or .txt file.")
    target = upload_dir(uc) / f"{int(time.time() * 1000)}-{name}"
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    kind = {"apkg": "apkg", "colpkg": "colpkg"}.get(ext, "csv")
    return {"path": str(target), "kind": kind, "name": name}


class ImportColpkg(BaseModel):
    path: str


@router.post("/import/colpkg")
def import_colpkg(body: ImportColpkg, uc: UserCollection = Depends(current_user)) -> dict:
    path = Path(body.path).resolve()
    if upload_dir(uc).resolve() not in path.parents or not path.is_file():
        raise HTTPException(400, "Upload the file first.")
    with uc.use() as col:
        col.create_backup(backup_folder=str(backup_dir(uc)), force=True, wait_for_completion=True)
    _replace_collection(uc, path)
    path.unlink(missing_ok=True)
    return {"ok": True}


# ---- export ---------------------------------------------------------------------


class Export(BaseModel):
    # apkg | colpkg | notes-csv | cards-csv
    kind: str
    deckId: int | None = None
    noteIds: list[int] | None = None
    cardIds: list[int] | None = None
    includeScheduling: bool = True
    includeMedia: bool = True
    includeDeckConfigs: bool = True
    legacy: bool = False
    withHtml: bool = True
    withTags: bool = True
    withDeck: bool = True
    withNotetype: bool = True
    withGuid: bool = False


def _limit(body: Export):
    if body.cardIds:
        return CardIdsLimit(body.cardIds)
    if body.noteIds:
        return NoteIdsLimit(body.noteIds)
    if body.deckId:
        return DeckIdLimit(body.deckId)
    return None


def export_dir(uc: UserCollection) -> Path:
    d = uc.dir / "exports"
    d.mkdir(parents=True, exist_ok=True)
    for f in d.iterdir():
        if time.time() - f.stat().st_mtime > 3600:
            f.unlink(missing_ok=True)
    return d


@router.post("/export")
def export(body: Export, uc: UserCollection = Depends(current_user)) -> dict:
    stamp = time.strftime("%Y-%m-%d@%H-%M-%S")
    with uc.use() as col:
        if body.kind == "colpkg":
            name = f"collection-{stamp}.colpkg"
            out = export_dir(uc) / name
            col.export_collection_package(str(out), include_media=body.includeMedia, legacy=body.legacy)
            col.reopen()
        elif body.kind == "apkg":
            deck = col.decks.name(body.deckId) if body.deckId else "cards"
            name = f"{_safe_name(deck)}-{stamp}.apkg"
            out = export_dir(uc) / name
            col.export_anki_package(
                out_path=str(out),
                options=ExportAnkiPackageOptions(
                    with_scheduling=body.includeScheduling,
                    with_deck_configs=body.includeDeckConfigs,
                    with_media=body.includeMedia,
                    legacy=body.legacy,
                ),
                limit=_limit(body),
            )
        elif body.kind == "notes-csv":
            name = f"notes-{stamp}.txt"
            out = export_dir(uc) / name
            col.export_note_csv(
                out_path=str(out), limit=_limit(body), with_html=body.withHtml, with_tags=body.withTags,
                with_deck=body.withDeck, with_notetype=body.withNotetype, with_guid=body.withGuid,
            )
        elif body.kind == "cards-csv":
            name = f"cards-{stamp}.txt"
            out = export_dir(uc) / name
            col.export_card_csv(out_path=str(out), limit=_limit(body), with_html=body.withHtml)
        else:
            raise HTTPException(400, "unknown export kind")
    return {"url": f"/api/export/{name}", "name": name}


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w\- ]+", "_", name.replace("::", "_")).strip() or "deck"


@router.get("/export/{name}")
def download_export(name: str, uc: UserCollection = Depends(current_user)) -> FileResponse:
    path = export_dir(uc) / os.path.basename(name)
    if not path.is_file():
        raise HTTPException(404, "That export has expired.")
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")


# ---- temp dir for the pages' file pickers ------------------------------------------

TMP = Path(tempfile.gettempdir())
