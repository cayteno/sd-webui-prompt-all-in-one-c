import os
import urllib.request
import urllib.error

current_dir = os.path.dirname(os.path.abspath(__file__))

def _get_tags_filename(name):
    file = os.path.join(current_dir, '../../group_tags/', name + '.yaml')
    return file

def _fetch_remote_yaml(remote_url, filename, timeout=5):
    """从远程 API 获取 YAML 文件内容，失败返回 None"""
    if not remote_url:
        return None
    try:
        url = remote_url.rstrip('/') + '/physton_prompt/remote_yaml?file=' + filename
        req = urllib.request.Request(url, headers={'User-Agent': 'sd-webui-prompt-all-in-one'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                data = resp.read().decode('utf-8-sig')
                return data
    except Exception:
        pass
    return None

def _read_local_yaml(filename):
    """读取本地 YAML 文件，失败返回 None"""
    file = _get_tags_filename(filename)
    if not os.path.exists(file):
        return None
    try:
        with open(file, 'r', encoding='utf8') as f:
            return f.read()
    except Exception:
        return None

def get_group_tags(lang, remote_url=None):
    # 确定主语言文件名
    main_file = None
    custom_data = _read_local_yaml('custom')
    if custom_data and len(custom_data.strip()) > 0:
        main_file = 'custom'
    else:
        lang_data = _read_local_yaml(lang)
        if lang_data is not None:
            main_file = lang
        else:
            default_data = _read_local_yaml('default')
            if default_data is not None:
                main_file = 'default'

    tags = ''

    # prepend.yaml（优先远程）
    prepend = None
    if remote_url:
        prepend = _fetch_remote_yaml(remote_url, 'prepend.yaml')
    if prepend is None:
        prepend = _read_local_yaml('prepend')
    if prepend:
        tags += prepend + "\n\n"

    # 主语言文件（优先远程 zh_CN.yaml 或 default.yaml）
    main_data = None
    if remote_url and main_file in ('zh_CN', 'default', 'custom'):
        remote_filename = main_file + '.yaml' if main_file != 'custom' else 'zh_CN.yaml'
        main_data = _fetch_remote_yaml(remote_url, remote_filename)
    if main_data is None and main_file:
        main_data = _read_local_yaml(main_file)
    if main_data:
        tags += main_data + "\n\n"

    # append.yaml（仅本地）
    append = _read_local_yaml('append')
    if append:
        tags += append + "\n\n"

    return tags