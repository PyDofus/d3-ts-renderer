"""
fast api serv that extract data on the fly.
Use it only for dev and testing
"""

import importlib
from contextlib import asynccontextmanager
from pathlib import Path

import UnityPy
import orjson
from UnityPy.export.Texture2DConverter import get_image_from_texture2d
from UnityPy.files import ObjectReader
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_settings import BaseSettings
from pydofus3.enum_data import TypeDataOther, TypeData as TypeDataDefault, TypeDataMac, TypeDataOtherMac
from pydofus3.extractor.data.tools import process_references, get_monoscript
from pydofus3.extractor.i18n import read as read_i18n
from pydofus3.not_generated.i18n import i18n_dict
from starlette.exceptions import HTTPException

TypeData: TypeDataDefault | TypeDataMac


class Settings(BaseSettings):
    game_path: Path
    tpm_path: Path = Path("tpm")


settings = Settings()


class GeneratingStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        if path.startswith(TypeDataDefault.Data):
            file_name = f"data_assets_{path.split('/')[-1].split('.')[0]}.asset.bundle"
            file = settings.game_path / TypeData.Data / file_name
            extract_datacenter(file)
            return await super().get_response(path, scope)

        raise HTTPException(status_code=404, detail="Not found")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global TypeData
    if (settings.game_path / TypeDataDefault.Data).exists():
        TypeData = TypeDataDefault
        i18n_path = settings.game_path / TypeDataOther.I18n
    elif (settings.game_path / TypeData.Data).exists():
        TypeData = TypeDataMac
        i18n_path = settings.game_path / TypeDataOtherMac.I18n
    else:
        raise FileNotFoundError("can't detect game client, check that game_path in env is correct")
    settings.tpm_path.mkdir(parents=True, exist_ok=True)
    i18n_dict.update(read_i18n(i18n_path))
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins="*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", GeneratingStaticFiles(directory=settings.tpm_path, check_dir=False), name="static")


@app.get("/extract/bone/{is_map_bone}/{bone_name}")
def bone_extract(is_map_bone: bool, bone_name: str):
    name = bone_name.lower()
    if is_map_bone:
        folder_type = TypeData.Animations
        file_name = f'props_assets_prop_{name}.bundle'
        output_type = TypeDataDefault.Animations
    else:
        folder_type = TypeData.Bones
        file_name = f'bones_assets_bone_{name}.bundle'
        output_type = TypeDataDefault.Bones
    output = settings.tpm_path / output_type / bone_name
    if output.exists():
        return
    env = UnityPy.load(str(settings.game_path / folder_type / file_name))
    bone_data = env.container[f'{name}.asset'].deref_parse_as_dict()
    skin_data = env.assets[0].files[bone_data['boneAsset']['m_PathID']]
    output.mkdir(parents=True, exist_ok=True)
    extract_skin_obj(skin_data, output)
    for anim in bone_data['animations']:
        (output / f'{anim["name"]}.dat').write_bytes(bytes(anim['dataBytes']))
        del anim['dataBytes']
    del bone_data['m_GameObject']
    del bone_data['m_Script']
    del bone_data['boneAsset']
    for i in bone_data['animations']:
        del i['data']
    for i in bone_data['graphics']:
        del i['asset']
    (output / "bone.json").write_bytes(orjson.dumps(bone_data))


@app.get("/extract/skin/{skin_id}")
def skin_extract(skin_id: str):
    output = settings.tpm_path / TypeDataDefault.Skins / skin_id
    if output.exists():
        return
    file_path = settings.game_path / TypeData.Skins / f'skins_assets_skin_{skin_id}.bundle'
    if not file_path.exists():
        raise FileNotFoundError
    env = UnityPy.load(str(file_path))
    skin_data = env.container[f'{skin_id}.asset'].deref()
    output.mkdir(parents=True, exist_ok=True)
    extract_skin_obj(skin_data, output)


def extract_skin_obj(obj: ObjectReader, output: Path):
    skin_data = obj.parse_as_dict()
    for nb, texture_ref in enumerate(skin_data['textures']):
        texture_path = texture_ref['m_PathID']
        if texture_path in obj.assets_file.files:
            texture = obj.assets_file.files[texture_path].read()
            get_image_from_texture2d(texture, False).save(output / f'{nb}.png')
    del skin_data['m_GameObject']
    del skin_data['m_Script']
    for i in skin_data['textures']:
        del i['m_PathID']

    (output / "skin.json").write_bytes(orjson.dumps(skin_data))


def extract_datacenter(file: Path) -> None:
    files = [str(file)]
    if mono_script := next(file.parent.glob('*monoscripts.bundle'), None):
        files.append(str(mono_script))
    env = UnityPy.load(*files)
    obj = next(iter(env.container.values())).deref()
    data = obj.parse_as_dict()
    process_references(data)
    if script_obj := get_monoscript(obj):
        data['m_Script'] = script = script_obj.parse_as_dict()
        import_path = f'pydofus3.generated.pydantic.{script.get("m_Namespace")}.{script.get("m_ClassName")}'
        try:
            class_ = importlib.import_module(import_path).__getattribute__(script['m_ClassName'])
            data = class_.model_validate(data).model_dump()
        except Exception as e:
            print(f'Error validating {import_path}: {e}, use unvalidated data')
    else:
        data['m_Script'] = None
    output = (settings.tpm_path / TypeDataDefault.Data / f"{data['m_Name'].lower()}.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(orjson.dumps(data, option=orjson.OPT_NON_STR_KEYS))
