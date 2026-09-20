// Playground templates — each showcases a different JLMP pattern.
// Each template carries BOTH a JASM source and an SDK equivalent so users
// can switch modes and see how they map to each other.

export const TEMPLATES = [
  // ============================================================
  // 1. Support ticket router — the flagship JLMP demo (all 4 primitives)
  // ============================================================
  {
    id: 'support-router',
    name: 'Support ticket router',
    tagline: 'P → M → J×2 → L — all four primitives',
    jasm: `.state ticket
.state history
.state screenshot

; P: extract facts from the customer's attached screenshot
SENSE %r0, image "identify product, order id, and any error codes visible" %screenshot

; M: pull similar past tickets from the corpus
RECALL %r1, top=3 "similar customer complaints" %history

; J: route to a team + score urgency (two JUDGEs → one Jev call)
JUDGE %r2, choice "which team handles this?" [billing, technical, account, other] %ticket
JUDGE %r3, score "how urgent is this?" ["low", "medium", "high", "critical"] %ticket

; L: draft an empathetic reply using everything above
GEN %r4, text "Draft a concise, empathetic reply. Reference similar past cases if useful." %ticket

; Escalate if urgency >= 3
BRANCH %r3 >= 3, .critical

.normal:
EMIT { team: %r2, urgency: %r3, draft: %r4, refs: %r1 }
HALT

.critical:
EMIT { team: %r2, urgency: "CRITICAL", draft: %r4, refs: %r1, page_on_call: true }
HALT`,
    sdk: `jasm()
  .state('ticket', 'history', 'screenshot')

  // P: perceive the attached screenshot
  .sense('screenshot', 'image', 'identify product, order id, and error codes')

  // M: recall similar past tickets
  .recall('history', 'similar customer complaints', { top: 3 })

  // J: two judgements fuse into one Jev call
  .judge('ticket', 'choice', 'which team?', ['billing', 'technical', 'account', 'other'])
  .judge('ticket', 'score', 'urgency?', ['low', 'medium', 'high', 'critical'])

  // L: draft the reply
  .gen('ticket', 'text', 'Draft a concise empathetic reply, use similar cases if useful')

  // Escalate if urgency >= 3
  .branch('$judge1', '>=', 3, 'critical')

  .label('normal')
    .emit({ team: '$judge0', urgency: '$judge1', draft: '$gen0', refs: '$recall0' })
    .halt()
  .label('critical')
    .emit({ team: '$judge0', urgency: 'CRITICAL', draft: '$gen0', refs: '$recall0', page_on_call: true })
    .halt()`,
    states: {
      ticket: `Charged twice for order #A-104 and nobody replied for 3 days. I want a refund NOW.`,
      history: { corpus: 'past_tickets' },
      screenshot: 'screenshot://mock/receipt.png',
    },
  },

  // ============================================================
  // 2. Content moderation — J heavy, showcases batching
  // ============================================================
  {
    id: 'moderation',
    name: 'Content moderation',
    tagline: 'J-heavy pipeline — 5 JUDGEs → 1 Jev call',
    jasm: `.state post

; Five parallel classifications — all fuse into ONE Jev API call.
JUDGE %r0, noul   "does this contain hate speech?"          %post
JUDGE %r1, noul   "does this contain sexual content?"       %post
JUDGE %r2, noul   "does this contain self-harm content?"    %post
JUDGE %r3, choice "what is the primary intent?" [inform, promote, argue, harm, other] %post
JUDGE %r4, score  "overall safety risk?" ["safe", "low", "medium", "high", "block"] %post

; Auto-block if any hard signal fires OR risk >= 3
BRANCH %r0 == true,  .block
BRANCH %r1 == true,  .block
BRANCH %r2 == true,  .block
BRANCH %r4 >= 3,     .block

.allow:
EMIT { verdict: "allow", risk: %r4, intent: %r3 }
HALT

.block:
EMIT { verdict: "block", risk: %r4, intent: %r3, hate: %r0, sexual: %r1, self_harm: %r2 }
HALT`,
    sdk: `jasm()
  .state('post')

  // Five parallel classifications — all fuse into ONE Jev call.
  .judge('post', 'noul',   'contains hate speech?')
  .judge('post', 'noul',   'contains sexual content?')
  .judge('post', 'noul',   'contains self-harm?')
  .judge('post', 'choice', 'primary intent?', ['inform', 'promote', 'argue', 'harm', 'other'])
  .judge('post', 'score',  'overall risk?', ['safe', 'low', 'medium', 'high', 'block'])

  // Auto-block if any hard signal fires OR risk >= 3
  .branch('$judge0', '==', true, 'block')
  .branch('$judge1', '==', true, 'block')
  .branch('$judge2', '==', true, 'block')
  .branch('$judge4', '>=', 3,    'block')

  .label('allow')
    .emit({ verdict: 'allow', risk: '$judge4', intent: '$judge3' })
    .halt()
  .label('block')
    .emit({ verdict: 'block', risk: '$judge4', intent: '$judge3', hate: '$judge0', sexual: '$judge1', self_harm: '$judge2' })
    .halt()`,
    states: {
      post: `Some folks around here keep pushing crypto scams. If you fall for it, you deserve what you get. LMAO.`,
    },
  },

  // ============================================================
  // 3. RAG-style research assistant — M → J → L
  // ============================================================
  {
    id: 'rag-answer',
    name: 'RAG research answer',
    tagline: 'M → J → L — retrieve, judge relevance, then write',
    jasm: `.state question
.state kb

; M: retrieve top candidates from the knowledge base
RECALL %r0, top=5 "documents relevant to the question" %kb

; J: judge whether we have enough context to answer
JUDGE %r1, score "how well do the retrieved docs answer the question?" ["none", "weak", "partial", "strong", "definitive"] %question
JUDGE %r2, choice "if we can't answer, why?" [insufficient_evidence, ambiguous_question, out_of_scope, none] %question

; If confidence weak → refuse gracefully
BRANCH %r1 <= 1, .refuse

.answer:
GEN %r3, text "Answer the question strictly using the retrieved passages. Cite them by id." %question
EMIT { answer: %r3, refs: %r0, confidence: %r1 }
HALT

.refuse:
GEN %r4, text "Explain politely why we can't answer this question with the available knowledge." %question
EMIT { answer: %r4, refs: %r0, confidence: %r1, refused: true, reason: %r2 }
HALT`,
    sdk: `jasm()
  .state('question', 'kb')

  // M: retrieve top-5 candidates
  .recall('kb', 'documents relevant to the question', { top: 5 })

  // J: judge sufficiency + failure reason (batched)
  .judge('question', 'score', 'how well do docs answer?', ['none', 'weak', 'partial', 'strong', 'definitive'])
  .judge('question', 'choice', 'if not, why?', ['insufficient_evidence', 'ambiguous_question', 'out_of_scope', 'none'])

  // Refuse gracefully if confidence weak
  .branch('$judge0', '<=', 1, 'refuse')

  .label('answer')
    .gen('question', 'text', 'Answer strictly using retrieved passages. Cite by id.')
    .emit({ answer: '$gen0', refs: '$recall0', confidence: '$judge0' })
    .halt()
  .label('refuse')
    .gen('question', 'text', 'Politely explain why we cannot answer with the available knowledge')
    .emit({ answer: '$gen1', refs: '$recall0', confidence: '$judge0', refused: true, reason: '$judge1' })
    .halt()`,
    states: {
      question: 'What was the exact revenue of Vercel in Q2 2025?',
      kb: { corpus: 'company_docs_2025' },
    },
  },

  // ============================================================
  // 4. Code review pipeline — J → L(code)
  // ============================================================
  {
    id: 'code-review',
    name: 'Code review',
    tagline: 'J → L(code) — assess + fix in one flow',
    jasm: `.state diff

; J: multi-dimensional review (all fuse into ONE Jev call)
JUDGE %r0, noul   "does the code have obvious bugs?"         %diff
JUDGE %r1, noul   "does the code follow project conventions?" %diff
JUDGE %r2, score  "how risky is this change?" ["trivial", "low", "medium", "high", "block"] %diff
JUDGE %r3, choice "what's the most important issue?" [correctness, style, performance, security, docs, nothing] %diff

; If low-risk and no bugs → approve
BRANCH %r0 == true, .fix
BRANCH %r2 >= 2,    .fix

.approve:
GEN %r4, text "Write a brief LGTM review comment (2 sentences)" %diff
EMIT { verdict: "approve", comment: %r4, risk: %r2 }
HALT

.fix:
GEN %r5, code "Rewrite the diff to fix the identified issues. Return unified diff format." lang="diff" %diff
GEN %r6, text "Review this diff. Explain what the original author changed and why it's problematic. Give actionable feedback." %diff
EMIT { verdict: "request_changes", risk: %r2, top_issue: %r3, patch: %r5, explanation: %r6 }
HALT`,
    sdk: `jasm()
  .state('diff')

  // J: multi-dimensional review — all fuse into ONE Jev call
  .judge('diff', 'noul',   'has obvious bugs?')
  .judge('diff', 'noul',   'follows project conventions?')
  .judge('diff', 'score',  'risk level?', ['trivial', 'low', 'medium', 'high', 'block'])
  .judge('diff', 'choice', 'most important issue?', ['correctness', 'style', 'performance', 'security', 'docs', 'nothing'])

  // Approve only if no bugs AND low risk
  .branch('$judge0', '==', true, 'fix')
  .branch('$judge2', '>=', 2,    'fix')

  .label('approve')
    .gen('diff', 'text', 'Write a brief LGTM comment (2 sentences)')
    .emit({ verdict: 'approve', comment: '$gen0', risk: '$judge2' })
    .halt()
  .label('fix')
    .gen('diff', 'code', 'Rewrite the diff to fix issues, return unified diff format', { lang: 'diff' })
    .gen('diff', 'text', 'Review this diff. Explain what the original author changed and why it is problematic. Give actionable feedback.')
    .emit({ verdict: 'request_changes', risk: '$judge2', top_issue: '$judge3', patch: '$gen0', explanation: '$gen1' })
    .halt()`,
    states: {
      diff: `--- a/auth.js
+++ b/auth.js
@@ -12,7 +12,7 @@ function verifyToken(token) {
   if (!token) return null;
-  const decoded = jwt.verify(token, process.env.JWT_SECRET);
+  const decoded = jwt.decode(token);  // faster
   return decoded.user;
 }`,
    },
  },

  // ============================================================
  // 5. Meeting note structurer — L(json) with schema
  // ============================================================
  {
    id: 'meeting-notes',
    name: 'Meeting notes → JSON',
    tagline: 'J → L(json) — structured extraction from raw notes',
    jasm: `.state transcript

; J: classify meeting type + judge if action items exist
JUDGE %r0, choice "meeting type?" [standup, planning, retrospective, review, one_on_one, other] %transcript
JUDGE %r1, noul   "does this meeting have action items?" %transcript

; L(json): extract structured notes
GEN %r2, json "Extract: participants (list), decisions (list), action_items (list of {who, what, when}), and a one-line summary." %transcript

BRANCH %r1 == false, .no_actions

.with_actions:
EMIT { type: %r0, notes: %r2, needs_followup: true }
HALT

.no_actions:
EMIT { type: %r0, notes: %r2, needs_followup: false }
HALT`,
    sdk: `jasm()
  .state('transcript')

  // J: classify + check action items
  .judge('transcript', 'choice', 'meeting type?', ['standup', 'planning', 'retrospective', 'review', 'one_on_one', 'other'])
  .judge('transcript', 'noul',   'has action items?')

  // L(json): extract structured notes
  .gen('transcript', 'json', 'Extract: participants, decisions, action_items ({who, what, when}), one-line summary')

  .branch('$judge1', '==', false, 'no_actions')

  .label('with_actions')
    .emit({ type: '$judge0', notes: '$gen0', needs_followup: true })
    .halt()
  .label('no_actions')
    .emit({ type: '$judge0', notes: '$gen0', needs_followup: false })
    .halt()`,
    states: {
      transcript: `Alice: OK let's ship v0.4 by Friday. Bob you own the migration.
Bob: I need review from Carol on the schema.
Carol: I can review Wed morning. Also we agreed to drop MySQL support in v0.5.
Alice: Confirmed. Bob please open the migration PR by Tue EOD.`,
    },
  },

  // ============================================================
  // 6. Multi-modal document intake — P + L(json)
  // ============================================================
  {
    id: 'document-intake',
    name: 'Document intake',
    tagline: 'P → J → L(json) — image → structured record',
    jasm: `.state document
.state metadata

; P: extract raw facts from the document image
SENSE %r0, image "extract all text, dates, amounts, names, and IDs from this document" %document

; J: classify the document + check completeness
JUDGE %r1, choice "document type?" [invoice, receipt, contract, id, medical, other] %document
JUDGE %r2, noul   "is signature present?" %document
JUDGE %r3, noul   "is date present?" %document
JUDGE %r4, score  "how usable is the scan?" ["unreadable", "poor", "ok", "good", "perfect"] %document

; Reject unusable scans
BRANCH %r4 <= 1, .reject

.accept:
; L(json): produce a normalized record
GEN %r5, json "Produce a normalized record with fields appropriate for the document type." %document
EMIT { status: "accepted", type: %r1, record: %r5, signed: %r2, dated: %r3, scan_quality: %r4 }
HALT

.reject:
EMIT { status: "rejected", reason: "unusable_scan", scan_quality: %r4, extracted_facts: %r0 }
HALT`,
    sdk: `jasm()
  .state('document', 'metadata')

  // P: extract raw facts from the image
  .sense('document', 'image', 'extract text, dates, amounts, names, IDs')

  // J: classify + completeness checks (all batched)
  .judge('document', 'choice', 'document type?', ['invoice', 'receipt', 'contract', 'id', 'medical', 'other'])
  .judge('document', 'noul',   'signature present?')
  .judge('document', 'noul',   'date present?')
  .judge('document', 'score',  'scan quality?', ['unreadable', 'poor', 'ok', 'good', 'perfect'])

  // Reject unusable scans
  .branch('$judge3', '<=', 1, 'reject')

  .label('accept')
    .gen('document', 'json', 'Produce a normalized record with fields appropriate for the type')
    .emit({ status: 'accepted', type: '$judge0', record: '$gen0', signed: '$judge1', dated: '$judge2', scan_quality: '$judge3' })
    .halt()
  .label('reject')
    .emit({ status: 'rejected', reason: 'unusable_scan', scan_quality: '$judge3', extracted_facts: '$sense0' })
    .halt()`,
    states: {
      document: 'screenshot://mock/invoice-A-104.png',
      metadata: { source: 'email', received_at: '2026-09-20T09:15:00Z' },
    },
  },
];

export const TEMPLATE_INDEX = TEMPLATES.map(t => ({
  id: t.id,
  name: t.name,
  tagline: t.tagline,
}));

export function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
}
