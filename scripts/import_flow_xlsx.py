import os
import math
import json
import hashlib
import pandas as pd
from datetime import datetime
from urllib import request, parse

XLSX_PATH = os.environ.get('FLOW_XLSX_PATH', 'flow/QNB_TrackerData (3).xlsx')
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
USER_EMAIL = os.environ.get('FLOW_USER_EMAIL')

if not SUPABASE_URL or not SERVICE_KEY or not USER_EMAIL:
    raise SystemExit('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or FLOW_USER_EMAIL')

headers = {
    'Authorization': f'Bearer {SERVICE_KEY}',
    'apikey': SERVICE_KEY,
    'Content-Type': 'application/json',
}


def http_request(method: str, url: str, params: dict | None = None, body: object | None = None):
    if params:
        url = f"{url}?{parse.urlencode(params)}"
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with request.urlopen(req) as resp:
            content = resp.read().decode('utf-8')
            return resp.status, content
    except Exception as e:
        raise RuntimeError(f"HTTP {method} failed: {e}")


def get_user_id(email: str) -> str:
    status, content = http_request(
        'GET',
        f"{SUPABASE_URL}/auth/v1/admin/users",
        params={'email': email},
    )
    if status >= 300:
        raise RuntimeError(f'User lookup failed: {status} {content}')
    data = json.loads(content)
    users = data.get('users', [])
    if not users:
        raise RuntimeError(f'No user found for {email}')
    return users[0]['id']


def clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime().isoformat()
    return value


def normalize_minute(ts: str) -> str:
    dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    return dt.replace(second=0, microsecond=0).isoformat()[:16]


def build_idem(sms: str, ts: str) -> str:
    content = ''.join(sms.split()).lower()[:100]
    base = f"{content}|{normalize_minute(ts)}"
    return hashlib.sha256(base.encode('utf-8')).hexdigest()


def post_rows(table: str, rows: list, on_conflict: str | None = None):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    for i in range(0, len(rows), 200):
        chunk = rows[i:i+200]
        req = request.Request(url, data=json.dumps(chunk).encode('utf-8'), method='POST')
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header('Prefer', 'resolution=merge-duplicates')
        try:
            with request.urlopen(req) as resp:
                _ = resp.read()
        except Exception as e:
            raise RuntimeError(f"Insert failed for {table}: {e}")


user_id = get_user_id(USER_EMAIL)

xl = pd.ExcelFile(XLSX_PATH)

# RawLedger
if 'RawLedger' in xl.sheet_names:
    df = xl.parse('RawLedger')
    rows = []
    for _, r in df.iterrows():
        ts = clean(r.get('Timestamp'))
        if not ts:
            continue
        raw_text = clean(r.get('RawText')) or ''
        idem = build_idem(raw_text, ts)
        rows.append({
            'user_id': user_id,
            'txn_timestamp': ts,
            'amount': float(r.get('Amount')) if clean(r.get('Amount')) is not None else None,
            'currency': clean(r.get('Currency')) or 'QAR',
            'counterparty': clean(r.get('Counterparty')),
            'card': clean(r.get('Card')),
            'direction': clean(r.get('Direction')),
            'txn_type': clean(r.get('TxnType')),
            'raw_text': raw_text,
            'net': clean(r.get('NET')),
            'idempotency_key': idem,
            'source': 'import',
        })
    post_rows('raw_ledger', rows, on_conflict='user_id,idempotency_key')

# MerchantMap
if 'MerchantMap' in xl.sheet_names:
    df = xl.parse('MerchantMap')
    rows = []
    for _, r in df.iterrows():
        pattern = clean(r.get('Pattern'))
        if not pattern:
            continue
        rows.append({
            'user_id': user_id,
            'pattern': str(pattern).lower(),
            'display_name': clean(r.get('Display Name')),
            'consolidated_name': clean(r.get('Consolidated Name')),
            'category': clean(r.get('Category')),
        })
    post_rows('merchant_map', rows, on_conflict='user_id,pattern')

# FXRates
if 'FXRates' in xl.sheet_names:
    df = xl.parse('FXRates')
    rows = []
    for _, r in df.iterrows():
        currency = clean(r.get('Currency'))
        if not currency:
            continue
        rows.append({
            'user_id': user_id,
            'currency': currency,
            'rate_to_qar': clean(r.get('RateToQAR')),
            'formula': clean(r.get('Formula')),
        })
    post_rows('fx_rates', rows, on_conflict='user_id,currency')

# UserContext
if 'UserContext' in xl.sheet_names:
    df = xl.parse('UserContext')
    rows = []
    for _, r in df.iterrows():
        type_val = clean(r.get('Type'))
        if not type_val:
            continue
        rows.append({
            'user_id': user_id,
            'type': type_val,
            'key': clean(r.get('Key')),
            'value': clean(r.get('Value')),
            'details': clean(r.get('Details')),
            'date_added': clean(r.get('DateAdded')),
            'source': clean(r.get('Source')),
        })
    post_rows('user_context', rows)

# Recipients
if 'Recipients' in xl.sheet_names:
    df = xl.parse('Recipients')
    rows = []
    for _, r in df.iterrows():
        phone = clean(r.get('Phone'))
        bank = clean(r.get('BankAccount'))
        short = clean(r.get('ShortName'))
        long = clean(r.get('LongName'))
        if not (phone or bank or short or long):
            continue
        rows.append({
            'user_id': user_id,
            'phone': str(phone) if phone is not None else None,
            'bank_account': bank,
            'short_name': short,
            'long_name': long,
        })
    post_rows('recipients', rows)

# Insights
if 'Insights' in xl.sheet_names:
    df = xl.parse('Insights')
    rows = []
    for _, r in df.iterrows():
        date = clean(r.get('Date'))
        insights = clean(r.get('Insights'))
        if not date or not insights:
            continue
        rows.append({
            'user_id': user_id,
            'date': date,
            'insights': insights,
        })
    post_rows('insights', rows)

print('Import complete')
