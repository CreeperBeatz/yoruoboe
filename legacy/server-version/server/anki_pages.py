"""Anki's own web pages, served as desktop Anki serves them, and the backend calls they make.

Deck options, statistics, card info, change note type, image occlusion, the importers
and the note editor are Anki's SvelteKit pages, built into the aqt wheel and unpacked
to vendor/anki-web. AnkiDroid shows the same pages; so does this app, in a frame.

The pages talk to the backend with `POST /_anki/<method>`, a protobuf body in and out.
Most methods go straight to the Rust backend (`col._backend.<method>_raw`); the rest are
the few the Qt host answers itself, re-implemented here (see aqt/mediasrv.py upstream).
The ones only a user interface can answer (file pickers, recording, dialogs) are
answered in the browser by the app around the frame: see server/static/anki-host.js.

docs/anki-pages-protocol.md describes every page's protocol.
"""

from __future__ import annotations

import json
import mimetypes
import re
from collections.abc import Callable
from pathlib import Path

import anyio
from anki import frontend_pb2, generic_pb2
from anki.collection import Collection
from anki.utils import from_json_bytes, to_json_bytes
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from . import config
from .auth import current_user
from .colman import UserCollection

router = APIRouter()

# Backend methods the pages may call directly: upstream's exposed_backend_list.
EXPOSED = [
    "latest_progress", "get_custom_colours",
    "get_deck_names", "get_deck",
    "i18n_resources",
    "get_csv_metadata", "get_import_anki_package_presets", "import_csv",
    "import_anki_package", "import_json_file", "import_json_string",
    "get_field_names", "get_note", "new_note", "note_fields_check", "defaults_for_adding",
    "default_deck_for_notetype", "add_note", "update_notes", "update_notetype",
    "get_notetype", "get_notetype_names", "get_change_notetype_info", "get_cloze_field_ords",
    "card_stats", "get_review_logs", "graphs", "get_graph_preferences", "set_graph_preferences",
    "complete_tag",
    "get_image_for_occlusion", "add_image_occlusion_note", "get_image_occlusion_note",
    "update_image_occlusion_note", "get_image_occlusion_fields",
    "compute_fsrs_params", "compute_optimal_retention", "set_wants_abort",
    "evaluate_params_legacy", "get_optimal_retention_parameters", "simulate_fsrs_review",
    "simulate_fsrs_workload",
    "get_ignored_before_count", "get_retention_workload",
    "encode_iri_paths", "decode_iri_paths", "html_to_text_line",
    "set_config_json", "get_config_bool",
    "add_media_file", "add_media_from_url", "add_media_from_path", "get_absolute_media_path",
    "extract_media_files",
    "get_card",
    "congrats_info", "get_deck_configs_for_update", "update_deck_configs",
]


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(p.title() for p in rest)


Handler = Callable[[Collection, bytes, UserCollection], bytes]


def _raw(method: str) -> Handler:
    def call(col: Collection, data: bytes, uc: UserCollection) -> bytes:
        return getattr(col._backend, f"{method}_raw")(data)

    return call


# ---- what the Qt host answers itself --------------------------------------------


def _get_setting(getter: Callable[[str], object], data: bytes) -> bytes:
    req = generic_pb2.String()
    req.ParseFromString(data)
    # A missing key must be JSON null: the pages JSON.parse the answer.
    return generic_pb2.Json(json=to_json_bytes(getter(req.val))).SerializeToString()


def _set_setting(setter: Callable[[str, object], None], data: bytes) -> bytes:
    req = frontend_pb2.SetSettingJsonRequest()
    req.ParseFromString(data)
    setter(req.key, from_json_bytes(req.value_json))
    return b""


class ProfileConfig:
    """What desktop keeps in its profile (per device, not synced): a JSON file per user."""

    def __init__(self, uc: UserCollection) -> None:
        self.path = uc.dir / "profile.json"

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except FileNotFoundError:
            return {}

    def get(self, key: str) -> object:
        return self._read().get(key)

    def set(self, key: str, value: object) -> None:
        data = self._read()
        data[key] = value
        self.path.write_text(json.dumps(data))


def _get_config_json(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    try:
        return _get_setting(col.conf.get_immutable, data)
    except KeyError:
        return generic_pb2.Json(json=b"null").SerializeToString()


def _scheduling_states(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    from anki.scheduler.v3 import SchedulingStatesWithContext

    current = uc.session.get("review")
    if not current:
        return SchedulingStatesWithContext().SerializeToString()
    return SchedulingStatesWithContext(
        states=current["states"], context=current["context"]
    ).SerializeToString()


def _set_scheduling_states(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    from anki.scheduler.v3 import SetSchedulingStatesRequest

    req = SetSchedulingStatesRequest()
    req.ParseFromString(data)
    current = uc.session.get("review")
    # The key is per review session: a stale page can't change the next card's states.
    if current and req.key == current["key"]:
        current["states"] = req.states
    return b""


def _noop(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    return b""


def _convert_pasted_image(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    # Desktop re-encodes with Qt; the browser already hands over PNG or JPEG, kept as is.
    req = frontend_pb2.ConvertPastedImageRequest()
    req.ParseFromString(data)
    return frontend_pb2.ConvertPastedImageResponse(data=req.data).SerializeToString()


def _change_notetype(col: Collection, data: bytes, uc: UserCollection) -> bytes:
    """The page leaves out which notes to change; the app said so when opening it."""
    from anki.notetypes_pb2 import ChangeNotetypeRequest

    req = ChangeNotetypeRequest()
    req.ParseFromString(data)
    nids = uc.session.get("change_notetype_nids")
    if not nids:
        raise ValueError("No notes were chosen for changing the note type.")
    del req.note_ids[:]
    req.note_ids.extend(nids)
    col.models.change_notetype_of_notes(req)
    uc.session.pop("change_notetype_nids", None)
    return b""


HOST: dict[str, Handler] = {
    "getConfigJson": _get_config_json,
    "getProfileConfigJson": lambda col, data, uc: _get_setting(ProfileConfig(uc).get, data),
    "setProfileConfigJson": lambda col, data, uc: _set_setting(ProfileConfig(uc).set, data),
    "getMetaJson": lambda col, data, uc: _get_setting(lambda key: None, data),
    "setMetaJson": _noop,
    "getSchedulingStatesWithContext": _scheduling_states,
    "setSchedulingStates": _set_scheduling_states,
    "convertPastedImage": _convert_pasted_image,
    "changeNotetype": _change_notetype,
    # Signals to the host. The frame's parent hears them through the fetch wrapper in
    # anki-host.js; the server has nothing to do.
    "deckOptionsReady": _noop,
    "deckOptionsRequireClose": _noop,
    "importDone": _noop,
    "importDialogRequireClose": _noop,
    "closeAddCards": _noop,
    "closeEditCurrent": _noop,
    "saveCustomColours": _noop,
    "openFieldsDialog": _noop,
    "openCardsDialog": _noop,
    "showInMediaFolder": _noop,
}

HANDLERS: dict[str, Handler] = {_camel(m): _raw(m) for m in EXPOSED} | HOST

# Polled every 100 ms by a page while a long call (import, FSRS optimizing) holds the
# collection, so they must not wait for the collection's lock.
LOCKLESS = {"latestProgress", "setWantsAbort", "i18nResources"}


@router.post("/_anki/{method}")
async def backend_call(method: str, request: Request, uc: UserCollection = Depends(current_user)) -> Response:
    # Same check as desktop: an opaque cross-site form post can't set this content type.
    if request.headers.get("content-type") != "application/binary":
        raise HTTPException(403, "unexpected content type")
    handler = HANDLERS.get(method)
    if handler is None:
        raise HTTPException(404, f"{method} not found")
    data = await request.body()

    def run() -> bytes:
        if method in LOCKLESS and uc.col is not None:
            return handler(uc.col, data, uc)
        with uc.use() as col:
            return handler(col, data, uc)

    try:
        out = await anyio.to_thread.run_sync(run)
    except Exception as exc:
        return Response(str(exc), status_code=500, media_type="text/plain")
    if not out:
        return Response(status_code=204)
    return Response(out, media_type="application/binary")


# ---- the pages themselves -------------------------------------------------------

SVELTEKIT_ROUTES = {
    "graphs", "congrats", "card-info", "change-notetype", "deck-options",
    "import-anki-package", "import-csv", "import-page", "image-occlusion", "editor",
}

# Pages that show note content keep SvelteKit's CSP, so script in a field can't run
# with the page's access to the API (as desktop does).
UNTRUSTED_ROUTES = {"editor", "image-occlusion"}

_CSP_META = re.compile(
    rb"<meta http-equiv=\"content-security-policy\" content=\"script-src 'self' ('sha256-[A-Za-z0-9+/=]+')\">"
)

# Lets the app hosting a page in a frame hear what the page asks of its host, as the Qt
# dialogs around these pages do on desktop. External, so the pages' CSP allows it, and
# first in <head>, so bridgeCommand exists before any of the page's code runs.
_HOST_SCRIPT = b'<script src="/anki-host.js"></script>'


def _index_html(route: str) -> tuple[bytes, dict[str, str]]:
    html = (config.ANKI_WEB / "sveltekit" / "index.html").read_bytes()
    headers = {"Cache-Control": "no-cache"}
    if route in UNTRUSTED_ROUTES:
        m = _CSP_META.search(html)
        script_hash = m.group(1).decode() if m else ""
        headers["Content-Security-Policy"] = (
            f"script-src 'self' {script_hash}; form-action 'none'; frame-ancestors 'self'"
        )
    else:
        html = _CSP_META.sub(b"", html)
        headers["Content-Security-Policy"] = "frame-ancestors 'self'"
    html = html.replace(b"<head>", b"<head>\n\t\t" + _HOST_SCRIPT, 1)
    return html, headers


def _send(path: Path, *, immutable: bool = False) -> Response:
    if not path.is_file():
        raise HTTPException(404)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix in (".mjs", ".js"):
        mime = "application/javascript"
    headers = {"Cache-Control": "public, max-age=31536000, immutable"} if immutable else {}
    return FileResponse(path, media_type=mime, headers=headers)


def _safe(base: Path, rel: str) -> Path:
    full = (base / rel).resolve()
    if base.resolve() not in full.parents:
        raise HTTPException(403)
    return full


@router.get("/_app/{rest:path}")
def sveltekit_asset(rest: str) -> Response:
    return _send(_safe(config.ANKI_WEB / "sveltekit" / "_app", rest), immutable="immutable/" in rest)


def legacy_path(rest: str) -> str:
    if "/" not in rest:
        # Top-level references (/_anki/reviewer.css) are remapped as upstream does.
        stem, ext = rest.rsplit(".", 1) if "." in rest else (rest, "")
        if ext == "css":
            return f"css/{rest}"
        if ext == "js":
            return f"js/vendor/{rest}" if stem in ("jquery", "jquery-ui", "plot") else f"js/{rest}"
    return rest


@router.get("/_anki/{rest:path}")
def legacy_asset(rest: str) -> Response:
    """css/, js/, imgs/ and pages/ as desktop serves them, for the card frame."""
    res = _send(_safe(config.ANKI_WEB, legacy_path(rest)))
    # The card frame is an opaque origin; MathJax's fonts are fetched with CORS.
    res.headers["Access-Control-Allow-Origin"] = "*"
    return res


def sveltekit_page(route: str) -> Callable[..., Response]:
    def page(rest: str = "", uc: UserCollection = Depends(current_user)) -> Response:
        if route == "editor" and rest:
            # The editor lives at /editor/, so its relative URLs land under it: Anki's
            # own styles (./_anki/css/editable.css) and the note's media (foo.jpg).
            if rest.startswith("_anki/"):
                return _send(_safe(config.ANKI_WEB, legacy_path(rest[len("_anki/"):])))
            return RedirectResponse(f"/media/{rest}", status_code=307)
        html, headers = _index_html(route)
        return Response(html, media_type="text/html", headers=headers)

    return page


for _route in SVELTEKIT_ROUTES:
    router.add_api_route(f"/{_route}", sveltekit_page(_route), methods=["GET"])
    router.add_api_route(f"/{_route}/{{rest:path}}", sveltekit_page(_route), methods=["GET"])
