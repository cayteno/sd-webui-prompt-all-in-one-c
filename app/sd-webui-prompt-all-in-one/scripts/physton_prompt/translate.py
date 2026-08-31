import json
import hashlib
import time
import threading
from scripts.physton_prompt.get_lang import get_lang
from scripts.physton_prompt.get_translate_apis import get_translate_apis, unprotected_translate_api_config
from scripts.physton_prompt.translator.alibaba_translator import AlibabaTranslator
from scripts.physton_prompt.translator.amazon_translator import AmazonTranslator
from scripts.physton_prompt.translator.baidu_translator import BaiduTranslator
from scripts.physton_prompt.translator.deepl_translator import DeeplTranslator
from scripts.physton_prompt.translator.google_tanslator import GoogleTranslator
from scripts.physton_prompt.translator.microsoft_translator import MicrosoftTranslator
from scripts.physton_prompt.translator.openai_translator import OpenaiTranslator
from scripts.physton_prompt.translator.tencent_translator import TencentTranslator
from scripts.physton_prompt.translator.translators_translator import TranslatorsTranslator
from scripts.physton_prompt.translator.yandex_translator import YandexTranslator
from scripts.physton_prompt.translator.youdao_translator import YoudaoTranslator
from scripts.physton_prompt.translator.mymemory_translator import MyMemoryTranslator
from scripts.physton_prompt.translator.niutrans_translator import NiutransTranslator
from scripts.physton_prompt.translator.caiyun_translator import CaiyunTranslator
from scripts.physton_prompt.translator.volcengine_translator import VolcengineTranslator
from scripts.physton_prompt.translator.iflytekV1_translator import IflytekV1Translator
from scripts.physton_prompt.translator.iflytekV2_translator import IflytekV2Translator
from scripts.physton_prompt.translator.mbart50_translator import MBart50Translator

caches = {}

# ============================================================
# 免费翻译 API 多路自动轮询配置
# ------------------------------------------------------------
# 说明：免费翻译接口（不需要 API KEY 的 translators 类接口）普遍不稳定，
# 单个接口经常失败或被限流。开启后，翻译时：
#   1. 优先使用你在设置里选择的接口；
#   2. 若它失败，自动切换到其他可用的免费接口（无需手动切换）；
#   3. 失败过的接口会进入冷却期，冷却期内不再优先尝试，实现多路轮流使用。
FREE_API_ROTATION = True          # 总开关：True 开启免费 API 自动轮询
FREE_API_FAIL_COOLDOWN = 60       # 单个免费接口失败后多少秒内不再优先尝试它（秒）
FREE_API_ATTEMPT_TIMEOUT = 12     # 免费接口单次尝试超时（秒），避免长时间卡在不可用的接口上
# ============================================================

# 记录各免费接口最近一次失败的时间，用于冷却（线程安全）
_free_api_failures = {}
_free_api_failures_lock = threading.Lock()


def _get_free_candidates(apis, to_lang):
    """收集所有支持目标语言的免费翻译 API key（按 translate_apis.json 中的顺序）。"""
    candidates = []
    for group in apis.get('apis', []):
        if group.get('type') != 'dont_need_api_key':
            continue
        for item in group.get('children', []):
            key = item.get('key')
            support = item.get('support') or {}
            if key and support.get(to_lang):
                candidates.append(key)
    return candidates


def _record_free_api_failure(api):
    with _free_api_failures_lock:
        _free_api_failures[api] = time.time()


def _is_free_api(apis, api):
    """判断指定的 api 是否属于免费（dont_need_api_key）分组。"""
    for group in apis.get('apis', []):
        if group.get('type') != 'dont_need_api_key':
            continue
        for item in group.get('children', []):
            if item.get('key') == api:
                return True
    return False


def translate(text, from_lang, to_lang, api, api_config=None):
    if api_config is None:
        api_config = {}
    global caches

    def _translate_result(success, message, translated_text):
        return {
            "success": success,
            "message": message,
            "text": text,
            "translated_text": translated_text,
            "from_lang": from_lang,
            "to_lang": to_lang,
            "api": api
        }

    def _cache_name(text):
        cache_name = f'{api}.{from_lang}.{to_lang}.{text}.' + json.dumps(api_config)
        cache_name = hashlib.md5(cache_name.encode('utf-8')).hexdigest()
        return cache_name

    apis = get_translate_apis()
    find = False
    for group in apis['apis']:
        for item in group['children']:
            if item['key'] == api:
                find = item
                break
    if not find:
        return _translate_result(False, get_lang('translate_api_not_found'), '')

    try:
        texts = []
        if isinstance(text, list):
            if len(text) < 1:
                return _translate_result(False, get_lang('translate_text_is_empty'), '')
            for item in text:
                texts.append(None)
            for index in range(len(text)):
                item = text[index]
                item = item.strip()
                if item == '':
                    texts[index] = ''
                    continue
                cache_name = _cache_name(item)
                if cache_name in caches:
                    texts[index] = caches[cache_name]
                else:
                    texts[index] = None
        else:
            text = text.strip()
            if text == '':
                return _translate_result(False, get_lang('translate_text_is_empty'), '')
            cache_name = _cache_name(text)
            if cache_name in caches:
                return _translate_result(True, '', caches[cache_name])

        # —— 免费翻译 API 多路自动轮询 ——
        # 优先尝试用户选择的接口；失败时自动切换到其他免费接口。
        # 最近失败过的接口进入冷却期，冷却期内不再优先尝试。
        if _is_free_api(apis, api) and FREE_API_ROTATION:
            try_api_list = [api]
            for candidate in _get_free_candidates(apis, to_lang):
                if candidate != api:
                    try_api_list.append(candidate)
            now = time.time()
            with _free_api_failures_lock:
                fresh = [k for k in try_api_list[1:]
                         if now - _free_api_failures.get(k, 0) >= FREE_API_FAIL_COOLDOWN]
                cooling = [k for k in try_api_list[1:] if k not in fresh]
            try_api_list = [api] + fresh + cooling
        else:
            try_api_list = [api]

        # 逐个尝试：第一个成功的接口即返回结果
        last_error = ''
        for try_api in try_api_list:
            try:
                if try_api == 'google':
                    translator = GoogleTranslator()
                elif try_api == 'microsoft':
                    translator = MicrosoftTranslator()
                elif try_api == 'openai':
                    translator = OpenaiTranslator()
                elif try_api == 'amazon':
                    translator = AmazonTranslator()
                elif try_api == 'deepl':
                    translator = DeeplTranslator()
                elif try_api == 'baidu':
                    translator = BaiduTranslator()
                elif try_api == 'alibaba':
                    translator = AlibabaTranslator()
                elif try_api == 'yandex':
                    translator = YandexTranslator()
                elif try_api == 'youdao':
                    translator = YoudaoTranslator()
                elif try_api == 'tencent':
                    translator = TencentTranslator()
                elif try_api == 'myMemory_free' or try_api == 'myMemory':
                    translator = MyMemoryTranslator()
                elif try_api == 'niutrans':
                    translator = NiutransTranslator()
                elif try_api == 'caiyun':
                    translator = CaiyunTranslator()
                elif try_api == 'volcengine':
                    translator = VolcengineTranslator()
                elif try_api == 'iflytekV1':
                    translator = IflytekV1Translator()
                elif try_api == 'iflytekV2':
                    translator = IflytekV2Translator()
                elif try_api == 'mbart50':
                    translator = MBart50Translator()
                else:
                    # translators 类接口
                    find_try = False
                    for group in apis['apis']:
                        for item in group['children']:
                            if item['key'] == try_api:
                                find_try = item
                                break
                    if not find_try or 'type' not in find_try or find_try['type'] != 'translators':
                        raise Exception(get_lang('translate_api_not_support'))
                    translator = TranslatorsTranslator(try_api)
                    translator.set_translator(find_try['translator'])

                translator.set_from_lang(from_lang)
                translator.set_to_lang(to_lang)
                attempt_config = dict(api_config)
                # 免费接口轮询时使用较短超时，避免卡在不可用接口上
                if _is_free_api(apis, try_api) and FREE_API_ROTATION:
                    attempt_config.setdefault('timeout', FREE_API_ATTEMPT_TIMEOUT)
                translator.set_api_config(unprotected_translate_api_config('translate_api.' + try_api, attempt_config))

                if isinstance(text, list):
                    translate_texts = []
                    translate_indexes = []
                    for index in range(len(texts)):
                        item = texts[index]
                        if item is None:
                            translate_indexes.append(index)
                            translate_texts.append(text[index])
                    if len(translate_texts) < 1:
                        return _translate_result(True, '', texts)
                    result = translator.translate_batch(translate_texts)
                    for index in range(len(result)):
                        item = result[index]
                        texts[translate_indexes[index]] = item
                        caches[_cache_name(translate_texts[index])] = item
                    return _translate_result(True, '', texts)
                else:
                    translated_text = translator.translate(text).strip()
                    caches[_cache_name(text)] = translated_text
                    return _translate_result(True, '', translated_text)
            except Exception as e:
                # print(e)
                if _is_free_api(apis, try_api) and FREE_API_ROTATION:
                    _record_free_api_failure(try_api)
                last_error = str(e)
                continue

        return _translate_result(False, last_error if last_error else get_lang('translate_api_not_support'), '')
    except Exception as e:
        # print(e)
        return _translate_result(False, str(e), '')
