# -*- coding: utf-8 -*-
"""
提示词库（group_tags/*.yaml）管理接口辅助模块
提供读取 / 保存 / 文件列表 / 免费翻译 能力，供界面化管理使用。
仅管理 group_tags 目录下以 .yaml 结尾的文件（防止路径穿越）。
保存时只保留「英文关键词: 中文翻译」的数据结构，不附加注释头。
"""
import os
import re
import json
import traceback
import urllib.request
import urllib.parse
from typing import List, Optional

import yaml

current_dir = os.path.dirname(os.path.abspath(__file__))
GROUP_TAGS_DIR = os.path.normpath(os.path.join(current_dir, '../../group_tags'))
DEFAULT_FILE = 'prepend.yaml'

# 允许新建/保存的“约定文件”（即使当前不存在也可保存）
CREATABLE_FILES = {'custom.yaml', 'append.yaml'}


def list_files() -> List[str]:
    """列出 group_tags 目录下所有可管理的 yaml 文件。"""
    files = []
    try:
        for fn in os.listdir(GROUP_TAGS_DIR):
            if fn.endswith('.yaml') and '.bak' not in fn:
                files.append(fn)
    except Exception:
        pass
    priority = {'prepend.yaml': 0, 'custom.yaml': 1, 'append.yaml': 2}
    files.sort(key=lambda f: (priority.get(f, 9), f))
    return files


def _safe_existing(name: str) -> Optional[str]:
    """校验并返回已存在的可管理文件名（防路径穿越）。不存在返回 None。"""
    if not name:
        name = DEFAULT_FILE
    name = os.path.basename(str(name))
    if not name.endswith('.yaml'):
        return None
    path = os.path.join(GROUP_TAGS_DIR, name)
    if os.path.exists(path):
        return name
    return None


def _safe_savable(name: str) -> Optional[str]:
    """校验可保存的文件名：已存在文件，或约定可新建文件。"""
    if not name:
        name = DEFAULT_FILE
    name = os.path.basename(str(name))
    if not name.endswith('.yaml'):
        return None
    if name in CREATABLE_FILES:
        return name
    path = os.path.join(GROUP_TAGS_DIR, name)
    if os.path.exists(path):
        return name
    return None


def get_data(file: str = DEFAULT_FILE) -> dict:
    """读取指定提示词库文件，返回结构化数据。"""
    name = _safe_existing(file)
    files = list_files()
    if not name:
        return {
            'file': file,
            'files': files,
            'exists': False,
            'data': [],
            'error': f'文件不存在或不可管理: {file}',
        }
    path = os.path.join(GROUP_TAGS_DIR, name)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        data = yaml.safe_load(_strip_comment_header(text))
        if data is None:
            data = []
        if not isinstance(data, list):
            data = []
        return {
            'file': name,
            'files': files,
            'exists': True,
            'data': data,
            'error': None,
        }
    except Exception as e:
        return {
            'file': name,
            'files': files,
            'exists': True,
            'data': [],
            'error': f'{e}',
        }


def _strip_comment_header(text: str) -> str:
    """去掉 YAML 文本开头的注释块（以 # 开头的连续行）。"""
    lines = text.split('\n')
    idx = 0
    while idx < len(lines) and lines[idx].strip().startswith('#'):
        idx += 1
    return '\n'.join(lines[idx:])


def download_file(file: str = DEFAULT_FILE) -> dict:
    """读取 yaml 文件原始内容，用于导出下载。"""
    try:
        name = _safe_savable(file)
        if not name:
            return {'success': False, 'message': f'文件不可读取: {file}'}
        path = os.path.join(GROUP_TAGS_DIR, name)
        if not os.path.exists(path):
            return {'success': False, 'message': f'文件不存在: {name}'}
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        return {'success': True, 'file': name, 'content': text}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'message': f'{e}'}


def import_yaml_text(text: str, file: str = DEFAULT_FILE) -> dict:
    """解析上传的 yaml 文本并替换保存到指定文件。"""
    try:
        name = _safe_savable(file)
        if not name:
            return {'success': False, 'message': f'文件不可保存: {file}'}
        data = yaml.safe_load(text)
        if data is None:
            data = []
        if not isinstance(data, list):
            return {'success': False, 'message': 'YAML 格式错误：根节点应为分类列表（数组）'}
        return save_data(data, name)
    except yaml.YAMLError as e:
        return {'success': False, 'message': f'YAML 解析失败: {e}'}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'message': f'{e}'}


def save_data(data: List, file: str = DEFAULT_FILE) -> dict:
    """校验并保存提示词库。data 为一级分类列表。只写数据，不写注释头。"""
    try:
        name = _safe_savable(file)
        if not name:
            return {'success': False, 'message': f'文件不可保存: {file}'}
        if not isinstance(data, list):
            return {'success': False, 'message': '数据格式错误：应为分类列表'}
        cleaned = _validate_and_clean(data)
        body = yaml.safe_dump(
            cleaned,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
            width=1000,
        )
        path = os.path.join(GROUP_TAGS_DIR, name)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body)
        return {'success': True, 'file': name}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'message': f'{e}'}


def _validate_and_clean(data: List) -> List:
    """清洗数据：保证结构合法、名称非空、无重复。返回清洗后的列表。"""
    cleaned = []
    seen_cat = set()
    for cat in data:
        if not isinstance(cat, dict):
            continue
        name = str(cat.get('name', '')).strip()
        if not name:
            continue
        if name in seen_cat:
            continue
        seen_cat.add(name)
        groups = []
        seen_group = set()
        for g in (cat.get('groups') or []):
            if not isinstance(g, dict):
                continue
            gname = str(g.get('name', '')).strip()
            if not gname:
                continue
            if gname in seen_group:
                continue
            seen_group.add(gname)
            tags = {}
            for k, v in (g.get('tags') or {}).items():
                if k is None or str(k).strip() == '':
                    continue
                tags[str(k).strip()] = '' if v is None else str(v)
            item = {'name': gname}
            color = g.get('color')
            if color and str(color).strip():
                item['color'] = str(color).strip()
            item['tags'] = tags
            groups.append(item)
        cleaned.append({'name': name, 'groups': groups})
    return cleaned


# 英文停用词：含这些词的短语不强行加连字符（更像句子/描述，保留空格更自然）
_EN_STOPWORDS = {
    'a', 'an', 'the', 'this', 'that', 'these', 'those',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
    'and', 'or', 'but', 'not', 'no', 'yes', 'so', 'if', 'then', 'than',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their',
}


def _maybe_join_hyphen(text: str) -> str:
    """中文→英文时，仅对「短的复合标签短语」用连字符连接，其余保留空格。

    判定规则（同时满足才加连字符）：
    1. 不含标点（逗号/句号/分号等，说明是多个标签或句子）；
    2. 词数在 2~4 之间；
    3. 不含英文停用词（a/the/is/of/with 等，含停用词更像描述句）。
    单词或不符合条件的短语保持原样（空格）。
    """
    if not text or ' ' not in text:
        return text
    if re.search(r'[,.;:!?，。；：！？]', text):
        return text
    words = re.findall(r"[A-Za-z0-9']+", text)
    if not (2 <= len(words) <= 4):
        return text
    if any(w.lower() in _EN_STOPWORDS for w in words):
        return text
    return re.sub(r'\s+', '-', text.strip())


def _mymemory_translate(text: str, sl: str, tl: str) -> Optional[str]:
    """调用 MyMemory 免费翻译，失败返回 None。"""
    url = 'https://api.mymemory.translated.net/get?' + urllib.parse.urlencode({
        'q': text,
        'langpair': f'{sl}|{tl}',
    })
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            d = json.loads(resp.read().decode('utf-8', errors='ignore'))
    except Exception:
        return None
    if d.get('responseStatus') != 200:
        return None
    t = (d.get('responseData', {}).get('translatedText', '') or '').strip()
    return t or None


def translate_free(text: str) -> dict:
    """免费翻译（MyMemory 免费接口，无需密钥）。

    - 含中文：译为英文；若结果为多词短语，用连字符连接以增强标签关联。
    - 无中文（英文等）：译为中文；优先按原文翻译，若原文无法翻译
      （如含连字符导致整词无法识别），自动把连字符替换为空格后再翻译。"""
    text = (text or '').strip()
    if not text:
        return {'success': False, 'message': '翻译内容为空'}
    has_cjk = bool(re.search(r'[\u4e00-\u9fff]', text))
    if has_cjk:
        t = _mymemory_translate(text, 'zh-CN', 'en')
        if t is None:
            return {'success': False, 'message': '翻译服务暂不可用'}
        t = _maybe_join_hyphen(t)
        return {'success': True, 'translated_text': t, 'from_lang': 'zh-CN', 'to_lang': 'en'}
    candidates = [text]
    replaced = text.replace('_', ' ')
    if replaced != text:
        candidates.append(replaced)
    for cand in candidates:
        t = _mymemory_translate(cand, 'en', 'zh-CN')
        if t and t.lower() != cand.lower():
            return {'success': True, 'translated_text': t, 'from_lang': 'en', 'to_lang': 'zh-CN'}
    return {'success': False, 'message': '翻译服务暂不可用'}


if __name__ == '__main__':
    print(json.dumps(get_data(), ensure_ascii=False, indent=2)[:2000])