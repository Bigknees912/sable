import json, glob, os, re, sys

SRC = "/root/.claude/uploads/dbb7f6be-11db-56db-8b52-1cc2e9d36034"
DST = "/home/user/mayfield-plumbing/n8n/workflows"
os.makedirs(DST, exist_ok=True)

OUT = {
    "WF1": "wf1-new-lead-capture.json",
    "WF2:": "wf2-preappointment-confirmation.json",
    "WF2b": "wf2b-sms-reply-handler.json",
    "WF3:": "wf3-job-completion-invoice-review.json",
    "WF3b": "wf3b-feedback-handler.json",
    "WF4": "wf4-tech-on-the-way.json",
    "WF5": "wf5-nurture-reactivation.json",
    "WF6": "wf6-weather-staffing-alert.json",
    "WF7": "wf7-billing-lifecycle.json",
    "WF8a": "wf8a-payment-retry-poller.json",
    "WF8b": "wf8b-payment-failed-entry.json",
    "WF9": "wf9-usage-drop-alert.json",
    "WF10": "wf10-seat-limit-upsell.json",
    "Website": "wf0-website-lead-capture.json",
}

# Our plan keys are starter/growth/pro; the workflows hardcoded the marketing
# names. Left unfixed, WF10's seat check never matches and nobody is nudged.
PLAN_KEY_FIXES = [("'solo'", "'starter'"), ("'team'", "'growth'"), ("'fleet'", "'pro'")]
PLAN_LABEL_JS = (
    "const planLabel = ({ starter: 'Solo', growth: 'Team', pro: 'Fleet' })"
    "[item.plan] || item.plan;"
)

# companies column renames: idealised -> real
COMPANY_COLS = {
    "company_name": "name",
    "owner_email": "contact_email",
    "google_review_url": "google_review_link",
    "service_type": "trade",          # WF6 reads the company's trade
    "email": "contact_email",         # WF8a/WF8b fall back to company.email
}

# Receivers that definitely hold a raw `companies` row. Anything else
# (d., bundle., $('Set Bundle')..., $('Build ...')...) is a workflow-local
# object whose keys keep the idealised names - renaming those was the bug in
# the first pass: it turned d.company_name into d.name, which is undefined.
COMPANY_RECEIVERS = [
    r"\bcompany\.",
    r"\$\('Get Company'\)\.item\.json\.",
    r"\$\('Get Active Companies'\)\.item\.json\.",
]

# Supabase nodes whose output row is a companies row.
COMPANY_SOURCE_NODES = {"Get Company", "Get Active Companies"}

# Nodes that forward their input item unchanged, so $json downstream still
# refers to whatever the last real data node produced.
PASSTHROUGH = {
    "n8n-nodes-base.if",
    "n8n-nodes-base.switch",
    "n8n-nodes-base.filter",
    "n8n-nodes-base.noOp",
    "n8n-nodes-base.splitInBatches",
    "n8n-nodes-base.respondToWebhook",
}


def rename_in(text, receivers):
    for recv in receivers:
        for old, new in COMPANY_COLS.items():
            text = re.sub(recv + old + r"\b", lambda m, n=new, r=recv: m.group(0)[: -len(old)] + n, text)
    return text


def rewrite_strings(obj, receivers):
    if isinstance(obj, dict):
        return {k: rewrite_strings(v, receivers) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rewrite_strings(v, receivers) for v in obj]
    if isinstance(obj, str):
        return rename_in(obj, receivers)
    return obj


def expr_concat(*parts):
    """Join literal/expression fragments into one n8n value.

    n8n values are either plain literals or '=' -prefixed expressions; you
    can't mix them, so if any fragment is an expression the whole result has
    to become one.
    """
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if not any(p.startswith("=") for p in parts):
        return "".join(parts)
    out = "="
    for p in parts:
        out += p[1:] if p.startswith("=") else p.replace("{{", "\\{\\{")
    return out


def sendgrid_to_resend(node):
    """Rewrite a SendGrid node into an HTTP Request against the Resend API.

    The project sends email through Resend (RESEND_API_KEY); the authored
    workflows all used SendGrid nodes, which would need a second ESP account.
    Credential: an n8n 'Header Auth' credential named "Resend" holding
    Authorization: Bearer <RESEND_API_KEY>.
    """
    p = node["parameters"]
    from_email = p.get("fromEmail", "")
    from_name = p.get("fromName", "")
    if from_email.startswith("<__PLACEHOLDER_VALUE__"):
        # Don't wrap a placeholder in angle brackets - it already has them,
        # and Resend wants one 'Name <addr>' string. Ask for the whole header.
        sender = '<__PLACEHOLDER_VALUE__Resend From header, e.g. Sable <alerts@runsable.com>__>'
        if from_name:
            sender = expr_concat(from_name, " ", sender)
    elif from_name:
        sender = expr_concat(from_name, " <", from_email, ">")
    else:
        sender = from_email

    node["type"] = "n8n-nodes-base.httpRequest"
    node["typeVersion"] = 4.2
    node["parameters"] = {
        "method": "POST",
        "url": "https://api.resend.com/emails",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": True,
        "contentType": "json",
        "specifyBody": "keypair",
        "bodyParameters": {
            "parameters": [
                {"name": "from", "value": sender},
                {"name": "to", "value": p.get("toEmail", "")},
                {"name": "subject", "value": p.get("subject", "")},
                {"name": "text", "value": p.get("contentValue", "")},
            ]
        },
        # A failed courtesy email must never fail the whole run.
        "options": {"response": {"response": {"neverError": True}}},
    }
    node["credentials"] = {"httpHeaderAuth": {"name": "Resend"}}
    return node


def drop_nodes(d, names):
    """Remove nodes and every connection into or out of them."""
    names = set(names)
    d["nodes"] = [n for n in d["nodes"] if n["name"] not in names]
    conns = {}
    for src, conn in d.get("connections", {}).items():
        if src in names:
            continue
        branches = []
        for branch in conn.get("main", []):
            branches.append([l for l in (branch or []) if l["node"] not in names])
        conns[src] = {"main": branches}
    d["connections"] = conns
    return d


# WF3's review-request branch duplicates the in-app send-review-request
# automation, which already suppresses the review after negative feedback
# (migration 070). Keeping both double-texts the customer. The invoice branch
# ahead of it is unique to n8n, so only the review tail is removed.
WF3_REVIEW_BRANCH = [
    "Carry Data Before Wait",
    "Wait 2 Hours",
    "Recheck Job Feedback",
    "Negative Feedback?",
    "Send Review SMS",
    "Update Job: Review Requested",
]


def upstream_map(d):
    """node name -> set of immediate predecessor node names"""
    up = {}
    for src, conn in d.get("connections", {}).items():
        for branch in conn.get("main", []):
            for link in branch or []:
                up.setdefault(link["node"], set()).add(src)
    return up


def adapt(path):
    d = json.load(open(path))
    name = d["name"]
    up = upstream_map(d)
    by_name = {n["name"]: n for n in d["nodes"]}

    for n in d["nodes"]:
        p = n.setdefault("parameters", {})

        # $json refers to a companies row only when the immediate upstream
        # node is one that selected from companies.
        def feeds_company(node_name, seen=None):
            seen = seen or set()
            for pr in up.get(node_name, set()):
                if pr in seen:
                    continue
                seen.add(pr)
                pn = by_name.get(pr, {})
                if (pr in COMPANY_SOURCE_NODES
                        and pn.get("type") == "n8n-nodes-base.supabase"):
                    return True
                if pn.get("type") in PASSTHROUGH and feeds_company(pr, seen):
                    return True
            return False

        json_is_company = feeds_company(n["name"])
        receivers = list(COMPANY_RECEIVERS)
        if json_is_company:
            receivers.append(r"\$json\.")

        n["parameters"] = rewrite_strings(p, receivers)
        p = n["parameters"]

        if n["type"] == "n8n-nodes-base.supabase":
            if p.get("tableId") == "contacts":
                p["tableId"] = "customers"

            # public.leads is already a tenant-scoped table; Sable's own
            # marketing funnel lives in marketing_leads (migration 073).
            if p.get("tableId") == "leads":
                p["tableId"] = "marketing_leads"

            for c in p.get("filters", {}).get("conditions", []):
                c["keyName"] = COMPANY_COLS.get(c["keyName"], c["keyName"]) \
                    if p.get("tableId") in ("companies", "companies_with_billing") else c["keyName"]

            for fv in p.get("fieldsUi", {}).get("fieldValues", []):
                if p.get("tableId") == "companies":
                    fv["fieldId"] = COMPANY_COLS.get(fv["fieldId"], fv["fieldId"])

            # jobs.status is the dispatch vocabulary; confirmation replies go
            # to their own column so the two never overwrite each other.
            if p.get("tableId") == "jobs" and p.get("operation") == "update":
                for fv in p.get("fieldsUi", {}).get("fieldValues", []):
                    if fv["fieldId"] == "status" and fv["fieldValue"] in (
                        "confirmed", "reschedule_requested"
                    ):
                        fv["fieldId"] = "confirmation_state"

            # Our booked-and-scheduled jobs are unassigned/assigned.
            if p.get("filterString"):
                p["filterString"] = p["filterString"].replace(
                    "status=eq.booked", "status=in.(unassigned,assigned)"
                )

            # Stripe events key off subscriptions.stripe_customer_id, which
            # only the joined view exposes.
            if p.get("tableId") == "companies":
                filt = json.dumps(p.get("filters", {})) + str(p.get("filterString", ""))
                if "stripe_customer_id" in filt and p.get("operation") != "update":
                    p["tableId"] = "companies_with_billing"

    if name.startswith("WF3:"):
        d = drop_nodes(d, WF3_REVIEW_BRANCH)

    for n in d["nodes"]:
        p = n.get("parameters", {})

        # WF8a suspends after the 4th failed attempt. companies.status has a
        # fixed vocabulary; reuse 'suspended' rather than inventing a third
        # suspension state - the reason is already in payment_failure_log.
        if p.get("tableId") == "companies":
            for fv in p.get("fieldsUi", {}).get("fieldValues", []):
                if fv["fieldId"] == "status" and fv["fieldValue"] == "suspended-for-payment":
                    fv["fieldValue"] = "suspended"

        # WF10 reads company.plan, which lives on subscriptions, not companies.
        if name.startswith("WF10") and n["name"] == "Get Company":
            p["tableId"] = "companies_with_billing"

        if name.startswith("WF10") and "jsCode" in p:
            if n["name"] == "Evaluate Nudge":
                for old, new in PLAN_KEY_FIXES:
                    p["jsCode"] = p["jsCode"].replace(old, new)
            if n["name"] == "Build Upsell Email":
                p["jsCode"] = re.sub(
                    r"const planLabel = .*?;", PLAN_LABEL_JS, p["jsCode"], count=1
                )

    for n in d["nodes"]:
        if n["type"] == "n8n-nodes-base.sendGrid":
            sendgrid_to_resend(n)

    return name, d


written = []
for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
    base = os.path.basename(path)
    if "WF" not in base and "Website" not in base:
        continue
    name, d = adapt(path)
    # Longest prefix wins: "WF10: ..." also startswith "WF1".
    key = next(
        (k for k in sorted(OUT, key=len, reverse=True) if name.startswith(k)), None
    )
    if not key:
        print("!! no output name for", name, file=sys.stderr)
        continue
    with open(os.path.join(DST, OUT[key]), "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    written.append((OUT[key], name))

for fn, name in sorted(written):
    print(f"{fn:44s} <- {name}")
print(f"\n{len(written)} workflows written")
