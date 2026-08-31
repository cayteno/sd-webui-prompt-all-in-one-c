import sys
import os

# Ensure working directory is the script's directory (fix for 宝塔/BT Panel)
os.chdir(os.path.dirname(os.path.abspath(__file__)))

AIO_PATH = os.path.abspath('./sd-webui-prompt-all-in-one/')
if AIO_PATH not in sys.path:
    sys.path.insert(0, AIO_PATH)

from dotenv import load_dotenv
import uvicorn
import gradio as gr
from gradio import Blocks
from fastapi import FastAPI, Response, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from starlette.requests import Request
from typing import Optional, Dict, Any
from scripts.on_app_started import on_app_started
from modules.script_callbacks import app_started_callback
import secrets
import install

if __name__ == "__main__":
    install.run()

    load_dotenv()
    app_port = os.environ.get('APP_PORT')
    if app_port:
        app_port = int(app_port)
    else:
        app_port = 17860
    app = FastAPI()

    # CORS - allow cross-origin requests (for remote YAML sharing)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app_username = os.environ.get('APP_USERNAME')
    app_password = os.environ.get('APP_PASSWORD')
    if app_username and app_password and app_username != '' and app_password != '':
        security = HTTPBasic()
        @app.middleware("http")
        async def authenticate(request: Request, call_next):
            # Allow CORS preflight requests without auth
            if request.method == "OPTIONS":
                return await call_next(request)
            try:
                credentials: HTTPBasicCredentials = await security(request)
                if not (secrets.compare_digest(credentials.username, app_username) and secrets.compare_digest(credentials.password, app_password)):
                    return Response(
                        "Unauthorized",
                        status_code=401,
                        headers={"WWW-Authenticate": "Basic"},
                    )
                return await call_next(request)
            except:
                return Response(
                    "Unauthorized",
                    status_code=401,
                    headers={"WWW-Authenticate": "Basic"},
                )

    @app.get("/sd-webui-prompt-all-in-one-js")
    async def sd_webui_prompt_all_in_one_js():
        # 扫描 ../javascript/ 目录下的所有 js 文件，合并为一个 js 文件
        js = ''
        for file in os.listdir(os.path.join(AIO_PATH, 'javascript')):
            if file.endswith('.js'):
                with open(os.path.join(AIO_PATH, 'javascript', file), 'r', encoding='utf-8') as f:
                    js += f.read() + '\n'
        response = Response(content=js, media_type="application/javascript")
        return response

    app_started_callback(Optional[Blocks], app)

    app.mount("/", StaticFiles(directory="./static", html=True), name="static")

    print("")
    print(f"Listening on port {app_port}...")
    print(f"Open http://localhost:{app_port}/?__theme=dark to access this app.")
    uvicorn.run(app, host="0.0.0.0", port=app_port, log_level="warning")