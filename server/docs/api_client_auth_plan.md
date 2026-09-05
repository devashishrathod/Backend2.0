# API Client Authentication — Plan

**Status:** 📋 DRAFT v2 — aapke jawaabon ke baad revise kiya gaya. Do chhote sawaal baaki hain ([§14](#-baaki-sawaal))
**Written:** 2026-09-04
**Scope:** Har request ko *"ye humara client hai"* prove karwana — JWT ke **upar** ek aur layer, JWT ki **jagah** nahi. Plus 3 adjacent gaps jo aapne scope me liye.
**Related:** [security_findings.md](./security_findings.md) · [security_fix_plan.md](./security_fix_plan.md) · [authorization_plan.md](./authorization_plan.md)

---

## 1. Decision log — jo tay ho chuka

| # | Sawaal | Faisla | Asar |
|---|---|---|---|
| Q1 | App kahan hai? | **Launch nahi hua, testing chal raha hai** | ✅ Koi purana user nahi. Version-aware grace period ki zaroorat **nahi**. Monitor mode chhota rakh sakte hain, enforce jaldi |
| Q2 | Registry kahan? | **Env var** (§5 me samjhaya) | DB model + admin CRUD → [Future](#-future-integrations) |
| Q3 | Kitna gehra? | **Sirf Layer 1** — ek env secret → crypto se key → frontend header me bheje → middleware verify kare | HMAC signing, device attestation, version rotation, admin-created keys → sab [Future](#-future-integrations) |
| Q4 | Scope? | **API key + G1 (CORS) + G2 (per-account limits) + G3 (session revoke)** | Alag-alag phases, API key pehle. ⚠️ Ek confirm chahiye — [§14](#-baaki-sawaal) |
| Q5 | Environments? | ⏳ pending | |
| Q6 | Third-party partner? | ⏳ pending | |

---

## 2. Aaj kya hai — baseline

`index.js` ka middleware chain:

| Layer | Status | Note |
|---|---|---|
| `helmet()` | ✅ | CSP off (koi HTML render nahi hota) |
| `compression()` | ✅ | |
| `cors()` | 🔴 **bilkul open** | `index.js:68` — koi origin allowlist nahi. **G1 isko fix karega** |
| `morgan` | ✅ | |
| `express-rate-limit` | 🟡 | 3000 req / 15 min **per IP**, webhooks exempt. CGNAT ki wajah se IP = person nahi. **G2 isko fix karega** |
| `fileUpload` | 🟡 | `useTempFiles` — koi bhi anonymous caller `/tmp` me file likhwa sakta hai |
| `express.json` | ✅ | rawBody webhook HMAC ke liye capture hota hai |
| JWT + role gates | ✅ | 209 endpoints, 32 route files, `buildAuthGate` ek hi implementation. **Revoke nahi ho sakta — G3** |

**Jo missing hai:** koi bhi cheez jo *caller ki identity* batati ho **user ke sign-in se pehle**. Aaj `/auth/loginOrSignUp-with-whatsapp` pe koi bhi, kahin se bhi, kitni bhi baar hit kar sakta hai.

---

## 3. ⚠️ Ek sach jo pehle sunna zaroori hai

**Mobile app ya web frontend me rakhi hui API key "secret" nahi hoti.** APK `apktool` se khul jaati hai, JS bundle DevTools me padha ja sakta hai, aur proxy (Burp / Charles) laga ke koi bhi apne hi phone ka har header dekh sakta hai.

To agar sawaal ye hai *"kya API key se determined attacker ruk jayega?"* — **nahi.**

**Lekin ye 5 cheezein zaroor deti hai:**

| Kya milta hai | Kyun matter karta hai |
|---|---|
| **Casual traffic block** | Bots, scrapers, URL guess karne wale — 100% ruk jaate hain |
| **Caller ki pehchaan** | Pata chalega request customer app se aayi, vendor panel se, ya kisi script se — **login se pehle bhi** |
| **Kill switch** | Key leak hui? Client band karo, us channel ka traffic mar jaata hai |
| **Rate limit ka sahi bucket** | Aaj limit IP pe hai aur CGNAT ki wajah se bekaar hai. `clientId` pe limit **sach me** kaam karti hai — G2 isi pe khada hai |
| **Server-to-server pe asli security** | `internal-jobs` ki key aapke server pe rehti hai — wahan ye **poori tarah strong hai** |

⚠️ Isliye ye doc me likh raha hoon: Layer 1 ship karke *"backend ab safe hai"* maan lena aadha sach hoga. Asli tamper-proofing [Future](#-future-integrations) me hai. Par Layer 1 **abhi karne layak hai** — upar wali 5 cheezein aaj bilkul nahi hain.

---

## 4. Design — ek nazar me

```
Frontend                                    Backend
────────                                    ───────
                                            ENV: API_KEY_ROOT_SECRET  (64 hex, kabhi share nahi)
                                                 API_CLIENTS = customer-app,vendor-panel,...

  (build me hardcoded)
  x-api-key: td_prod.customer-app.v1_9fK2mQ...
       │
       └──── request ────────────────────►  apiClientAuth middleware
                                              1. header hai?           nahi → 401
                                              2. format sahi hai?      nahi → 401
                                              3. HMAC recompute + timingSafeEqual
                                                                       nahi → 401
                                              4. clientId API_CLIENTS me hai?
                                                                       nahi → 401
                                              5. req.apiClient = { id: "customer-app" }
                                                 next()
                                                     │
                                                     ▼
                                              rateLimit (bucket = clientId)
                                                     │
                                                     ▼
                                              routes → JWT gate → role gate → controller
```

**Key kabhi store nahi hoti.** Server ke paas sirf root secret hai; verification = HMAC dobara compute karna. Isliye zero DB read, zero storage, O(1).

---

## 5. Registry kya hai — practically

Middleware do alag sawaal poochta hai:

| Sawaal | Kaise jawab milta hai | Kya chahiye |
|---|---|---|
| **"Ye key asli hai?"** | Root secret se HMAC dobara compute karo, `timingSafeEqual` se compare | Sirf root secret. Koi list nahi |
| **"Ye caller allowed hai?"** | `clientId` allowed list me hai? | ← **ye list hi "registry" hai** |

Doosra check kyun chahiye: agar sirf pehla ho, to ek baar generate ki hui key **hamesha** valid rahegi. Vendor panel ki key leak ho gayi aur usko band karna hai — bina registry ke ek hi raasta hai: **root secret badlo, jisse sab clients ek saath mar jaayenge.**

**Aapke faisle ke hisaab se registry ek env var hai:**

```bash
API_CLIENTS=customer-app,vendor-panel,admin-panel,internal-jobs
```

Client band karna = us naam ko hata ke redeploy. Bas.

⚠️ Trade-off jo aapko pata hona chahiye: **rotate/revoke karne ke liye redeploy chahiye.** Testing phase me ye bilkul theek hai. Jab live users aa jaayenge aur ek key leak hogi, tab redeploy ka wait mehnga lagega — us waqt DB-backed registry ([Future](#future-1--db-registry--admin-panel-se-rotation)) chahiye hogi. Design abhi se aisa rakhenge ki wo swap ek file ka change ho.

---

## 6. Key format aur derivation

```
ENV:  API_KEY_ROOT_SECRET = crypto.randomBytes(32).toString("hex")     // 64 hex chars

keyId   = `${env}.${clientId}.v${version}`                             // "prod.customer-app.v1"
sig     = base64url( HMAC-SHA256(ROOT_SECRET, keyId) )
apiKey  = `td_${keyId}_${sig}`
```

Example: `td_prod.customer-app.v1_9fK2mQx7RtLp3vNc8WsJdA1eYoB4zHgU5iTnFmKrXQw`

**Verify:**
1. `td_` prefix hatao, aakhri `_` pe todo → `keyId` + `sig`
2. `keyId` se HMAC dobara banao
3. `crypto.timingSafeEqual(computed, received)` — *(repo me yahi pattern already hai, Razorpay webhook HMAC me)*
4. `keyId` se `env` aur `clientId` nikaalo → `env` current environment se match kare, `clientId` `API_CLIENTS` me ho

### Format ke 3 faisle, aur unke kaaran

| Faisla | Kyun |
|---|---|
| **`env` key ke andar hai** | Staging ki key production pe nahi chalegi. Ye ek asli bug class hai jo apne aap band ho jaata hai — QA galti se prod hit kar de to 401 milega, silent data corruption nahi |
| **`clientId` plain text me hai** | Log me `clientId` chahiye (kaun call kar raha hai), aur registry check ke liye bhi. Ye secret nahi hai — secret to `sig` hai |
| **`version` abhi bhi format me hai** | ⚠️ Aapne kaha version baad me. Bilkul — **rotation UI baad me**. Par `v1` string me **abhi** daal rahe hain kyunki baad me add karne ka matlab hoga har purani key invalid karna aur saare frontends ek saath redeploy karna. String me ek `v1` rakhne ka aaj cost zero hai |

### Env vars

```bash
API_KEY_ROOT_SECRET=<64 hex>        # kabhi kisi client build me nahi jaana chahiye
API_CLIENTS=customer-app,vendor-panel,admin-panel
API_KEY_MODE=monitor                # off | monitor | enforce
API_KEY_ENV=prod                    # key ke andar wala env marker
```

⚠️ **`API_KEY_MODE` apna khud ka env var hai, `NODE_ENV` se derive nahi.** CLAUDE.md warn karta hai ki is dev machine ke kuch shells me `NODE_ENV=production` set hai — behaviour ko usse hang karna ek jaana-pehchana trap hai.

### CLI

```bash
node scripts/generateApiKey.js customer-app          # key print karo
node scripts/generateApiKey.js --all                 # saare configured clients ki keys
node scripts/generateApiKey.js --verify td_prod...   # ek key check karo
```

⚠️ Script **kabhi root secret print nahi karegi.** Aur key print karte waqt yaad dilayegi ki ye chat/email pe na bheji jaaye.

---

## 7. Middleware kahan lagega — aur ⚠️ kya exempt hoga

### 7.1 Chain me jagah

```js
app.use(helmet(...));
app.use(compression());
app.use(cors(...));                    // ← G1 yahan allowlist banayega
app.use(morgan(...));

app.use(apiClientAuth());              // ← NAYA

app.use(rateLimit({
  keyGenerator: req => `${req.apiClient?.id ?? "anon"}:${req.ip}`,   // ⚠️ composite — C1 padhein
  limit: req => req.apiClient ? 3000 : 100,                          // bina key wale pe sakht
  ...
}));
app.use(fileUpload(...));
app.use(express.json({ verify: ... }));
app.use("/trydood/v1", allRoutes);
```

**Rate limit se pehle kyun:** (a) bina key wala junk sabse sasti jagah pe reject ho, aur (b) rate limiter ko `clientId` mile taaki **bina key wale traffic pe alag, sakht limit** lag sake.

⚠️ Bucket **`clientId` akela nahi, `clientId:ip` composite** hai. Sirf `clientId` pe karne se poora customer app ek hi 3000-request bucket share karega aur seckndon me mar jayega — [C1](#c1-rate-limiter-ka-keygenerator--jaise-likha-tha-waise-karne-se-production-instantly-marta) me poora explanation.

**`fileUpload` se pehle kyun:** `useTempFiles: true` hai. Aaj koi bhi anonymous caller multipart bhej ke disk pe file likhwa sakta hai. Key check pehle rakhne se wo band.

### 7.2 🔴 Exempt list — ye galat hua to paisa rukega

Ye endpoints **kabhi** key demand nahi kar sakte, kyunki caller header bhej hi nahi sakta:

| Path | Kaun call karta hai | Block hua to |
|---|---|---|
| `POST /trydood/v1/transactions/webhook/razorpay` | Razorpay servers | 🔴 **Paisa chupchaap rukna shuru.** Razorpay 401 pe kuch der retry karta hai phir drop kar deta hai. Koi error, koi alert nahi |
| `POST /trydood/v1/transactions/webhook/razorpay/customer` | Razorpay servers | 🔴 Customer ka voucher claim activate hi nahi hoga |
| `GET /trydood/v1/transactions/invoice/:token` | WhatsApp link se aaya browser | Customer apna invoice nahi dekh paayega |
| `GET /trydood/v1/settlements/statement/:token` | Link se aaya vendor ka browser | Vendor apna payout statement nahi dekh paayega |
| `GET /`, `/my-ip`, `/client-ip` | Health check / ops | Uptime monitor red, deploy fail |
| **`OPTIONS` (koi bhi path)** | Browser CORS preflight | 🔴 **Admin aur vendor panel ki har request mar jaayegi** |

⚠️ **`OPTIONS` wali baat sabse aasani se miss hoti hai.** Browser preflight request pe custom headers bhejta hi nahi. Postman me sab pass hoga aur browser me kuch bhi kaam nahi karega — debug karne me ghante jaate hain.

⚠️ **Exempt list ek hi jagah rahegi** — `constants/apiClient.js` me. `index.js` ka maujooda `WEBHOOK_PATHS` bhi wahin se padhega. Warna teesra webhook add hone pe ek jagah update hogi aur doosri nahi, aur wo failure silent hai.

⚠️ `invoice/:token` aur `statement/:token` **already** apne signed token se protected hain — inhe exempt karna koi naya hole nahi khol raha.

---

## 8. Rollout — app launch nahi hua, isliye seedha

Aapne bataya app abhi testing me hai. Isliye version-aware grace period **nahi chahiye** aur monitor window chhota rakh sakte hain.

```
API_KEY_MODE = off | monitor | enforce
```

| Mode | Kya karta hai |
|---|---|
| `off` | Pass-through. **Kill switch** — kuch bhi galat ho to yahan aa jao, redeploy ke bina bhi (env var restart) |
| `monitor` | Key check karta hai, reject kuch nahi karta. Fail hone wali request log hoti hai: `path`, `method`, `user-agent`, key thi ya nahi |
| `enforce` | Ab actually 401 |

**Monitor phir bhi kyun chahiye, jab koi live user nahi hai?** Kyunki *aapke apne* callers ki poori list kisi ko yaad nahi hoti — QA ki Postman collection, koi purana script, koi cron, kisi dev ka local frontend. Monitor 2-3 din chalake log dekh lo; jo bhi chhoot gaya hai wo naam se dikh jayega. Enforce tab flip karo jab log saaf ho.

⚠️ **Enforce apna alag phase hai, Phase 1 ka hissa nahi.** Wo ek deliberate, dekh-ke-liya gaya faisla hai.

---

## 9. Error paths — user ko actually kya dikhega

🔴 **Har failure `403` hai, `401` nahi.** Wajah [C2](#c2-har-failure-pe-401--teeno-frontends-ko-logout-loop-me-daal-dega) me hai: har frontend ka interceptor `401` ko "session expired" maanta hai, to API key ka problem user ko **logout** kar dega — aur dobara login bhi usi error se fail hoga, matlab infinite loop.

| Kya hua | HTTP + code | Client kya kare | **Screen pe kya dikhega** |
|---|---|---|---|
| Header hi nahi bheja | `403` `API_KEY_MISSING` | Retry se theek nahi hoga — build galat hai. **Logout mat karo** | ⚠️ **Har screen fail.** Isliye monitor mode. Message *"App update karein"* hona chahiye, *"Something went wrong"* nahi |
| Key format galat | `403` `API_KEY_INVALID` | Retry mat karo. **Logout mat karo** | Same |
| HMAC match nahi hua (forged) | `403` `API_KEY_INVALID` | Retry mat karo. **Logout mat karo** | Same |
| `clientId` registry me nahi (revoked) | `403` `API_KEY_REVOKED` | **Force update prompt** | *"Is app version ka support khatam ho gaya. Play Store se update karein."* — actionable, jo pehla message nahi hai |
| `env` mismatch (staging key, prod server) | `403` `API_KEY_ENV_MISMATCH` | Config theek karo | Sirf dev/QA dekhega. Log me saaf likha ho *"key `staging` ki hai, server `prod` hai"* — warna ye ghanton kha jaata hai |

⚠️ **Frontend teams ko ye explicitly batana hoga:** `403` + koi bhi `API_KEY_*` code = build/config ka problem, user ke session ka nahi. Token clear mat karo, refresh mat karo, login screen pe mat bhejo.

⚠️ **Error body me clientId echo mat karo.** Attacker ko valid clientIds ki list nahi milni chahiye.

⚠️ **Response envelope wahi rahega** — `utils/response.js` se `{ success: false, message, details }`. Naya shape nahi.

⚠️ **Log me kabhi poori key nahi.** `clientId` + last 4 chars. Warna ek log leak = key leak.

---

## 10. Blast radius — kya-kya chhuna padega

| File / area | Change | Risk |
|---|---|---|
| `index.js` | 1 naya `app.use`, `WEBHOOK_PATHS` → shared exempt list, rate limiter ka `keyGenerator` | 🔴 High — har request isse guzarti hai |
| `middlewares/apiClientAuth.js` | **naya** | — |
| `middlewares/index.js` | barrel export | — |
| `helpers/apiClients/` | `deriveApiKey`, `verifyApiKey`, `isClientAllowed` | — |
| `constants/apiClient.js` | **naya** — modes, exempt paths, error codes | — |
| `scripts/generateApiKey.js` | **naya** CLI | — |
| `.env` / `.env.example` | 4 naye vars | — |
| `postman/` | Collection-level header + variable | 🟡 ⚠️ Generators captured examples delete kar dete hain (15,499 lines measured) — sirf wahi generator chalao jiska source badla, aur `git diff --stat postman/` check karo |
| `__tests__/` | supertest se app hit karne wale tests | 🟡 Test env me `API_KEY_MODE=off`, warna sab red |
| `docs/API_DOCUMENTATION.md`, `endpoints_category.md` | Naya required header document karna | — |
| **Frontend × 3** | Customer app, vendor panel, admin panel ke HTTP client me header | 🔴 Aapki team ka kaam |

---

## 11. Phases

| Phase | Kya | Effort | Note |
|---|---|---|---|
| **P0** | Root secret, `generateApiKey.js`, `.env.example`, constants | ~2 ghante | |
| **P1** | `apiClientAuth` middleware + exempt list + `monitor` ON + rate limiter `keyGenerator` | ~1 din | |
| **P2** | Postman + docs + tests update; frontend team ko keys | ~half din | Frontend ka kaam yahin se shuru |
| **P3** | Monitor log saaf → **`enforce` ON** | ~1 ghanta | Deliberate flip, 2-3 din baad |
| **P4** | **G1 — CORS allowlist** | ~2-3 ghante | Panel origins ki list chahiye |
| **P5** | **G2 — Per-account rate limits** | ~1.5 din | Apna design section neeche |
| **P6** | **G3 — Session revoke + refresh token** | ~2-3 din | Sabse bada, frontend change bhi maangta hai |

⚠️ P4 ko P1 ke saath karna bhi theek hai — `x-api-key` ek custom header hai, to CORS ka `allowedHeaders` waise bhi chhuna padega. Ek hi jagah do baar jaane se behtar hai ek baar jaana.

---

## 12. G1–G3 — jo aapne scope me liye

### G1 — CORS lockdown

**Aaj:** `app.use(cors())` — `index.js:68`. Har origin allowed.

**Problem, concretely:** ek admin apne browser me panel khol ke rakhta hai. Usi browser me wo koi doosri site kholta hai. Wo site JavaScript se aapki API call kar sakti hai — aur browser **admin ka `Authorization` header attach karega agar wo cookie-based hota**; token localStorage me ho to attacker ko usse padhna padega, jo CORS open hone pe *response padh paana* aasan bana deta hai. Dono soorat me open CORS attacker ka kaam aasan karta hai.

⚠️ **API key isse nahi bachati.** Wo malicious site aapke bundle se key bhi utha legi. Sirf origin allowlist bachati hai.

**Fix:**
```js
app.use(cors({
  origin: (origin, cb) => { /* ADMIN_PANEL_URL, VENDOR_PANEL_URL, aur allowlist */ },
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
}));
```

⚠️ **Mobile app ka koi `Origin` header nahi hota** — native HTTP client CORS follow nahi karta. To `origin === undefined` ko **allow** karna padega, warna app mar jayega. Ye counter-intuitive hai par zaroori: CORS ek *browser* ka mechanism hai, aur mobile pe uska koi matlab hi nahi.

**Chahiye:** `ADMIN_PANEL_URL` aur `VENDOR_PANEL_URL` env me already hain. Local dev origins (`localhost:3000` etc.) ki list bhi chahiye hogi.

### G2 — Per-account rate limits

**Aaj:** sirf global per-IP 3000/15min. CLAUDE.md khud kehta hai: *"Per-account limits on OTP, login and refund requests are the real protection and do not exist yet."*

**Achhi khabar:** ye pattern is repo me **already maujood hai**. `services/otps/sendOtp.js` + `models/OtpThrottle.js` ek rolling-window throttle karte hain jo **target pe keyed hai, IP pe nahi** — aur wo route pe nahi, service ke andar baitha hai (taaki naya route add karne wala bhoolne se unprotected na ho jaaye). G2 basically usi machinery ko 3 aur jagah le jaana hai:

| Endpoint | Kis pe key karein | Kyun |
|---|---|---|
| `POST /auth/login` (password, admin-only) | `email` + failed-attempt counter | Brute force. Ye G3 ke `failedLoginAttempts` + lockout ke saath naturally jaata hai |
| OTP **verify** endpoints | phone/email | `verifyOtp` me attempt cap hai, par ek naya OTP maang ke counter reset ho jaata hai |
| Refund request | `customerId` | Abuse + admin queue flood |

⚠️ **IP pe kabhi nahi** — CLAUDE.md ka rule: Indian mobile networks hazaaron real customers ko ek CGNAT address ke peeche daalte hain. IP limit ek attacker ko phone ke saath bilkul nahi rokti, par ek poore block ke paying users ko lock kar deti hai.

⚠️ **Counter Mongo me, process me nahi** — `OtpThrottle` ka precedent follow karo. Aur claim **wahi write ho** (aggregation-pipeline update, `{ updatePipeline: true }`) — read-then-write do simultaneous taps ko do slots de deta hai.

⚠️ Ye apne aap me ek design doc maangta hai. Yahan mai sirf shape likh raha hoon; P5 shuru karte waqt uska apna plan banega.

### G3 — Session revoke + refresh token

**Aaj:** JWT stateless hai. `User` pe koi `tokenVersion` nahi. Matlab:
- Token leak hua → `JWT_EXPIRY` tak zinda, kuch nahi kar sakte
- Password change hua → purane sessions chalte rehte hain
- Koi refresh flow nahi, to `JWT_EXPIRY` lamba rakhna padta hai = exposure window lamba

**Ek hissa already hai:** `helpers/auth/assertAccountAccess.js` `User.sessionInvalidatedAt` check karta hai aur `iat` uske pehle ka ho to refuse karta hai. **Session-kill ka mechanism maujood hai** — bas wo ek per-user timestamp hai, aur usse trigger karne ka koi endpoint / password-change hook nahi hai.

To G3 utna bada nahi hai jitna lagta hai. Do tukde:
1. **Revoke wire up karo** — password change pe, logout-all pe, aur admin ke "force sign out" pe `sessionInvalidatedAt` set karo. Ye chhota hai, foundation already hai
2. **Refresh token flow** — access token chhota (15 min), refresh token lamba aur DB me stored/revocable. Ye bada hai aur **teeno frontends ka change maangta hai**

⚠️ **Tukda 2 pehle frontend ke saath discuss hona chahiye.** Refresh flow ka matlab hai har client me token-refresh interceptor aur race handling (ek saath 5 requests 401 khaayein to 5 refresh calls nahi jaani chahiye). Backend akela ye ship nahi kar sakta.

---

## 13. Kaise verify karenge

- **Unit:** key derive → verify roundtrip; galat root reject; galat `env` reject; unknown `clientId` reject; `timingSafeEqual` use ho raha hai (`===` nahi)
- **Integration (supertest):** har exempt path bina key ke 200 de; ek normal path bina key ke `monitor` me 200 aur `enforce` me 401 de; `OPTIONS` dono modes me pass ho
- 🔴 **Manual, deploy se pehle:** Razorpay dashboard se webhook ka **test event** fire karo aur confirm karo 200 aaya. Ye sabse mehnga failure hai aur test isse poori tarah cover nahi karta
- **Manual:** browser se admin panel kholo — preflight `OPTIONS` pass ho raha hai, aur real request bhi
- `__tests__/money/` red na ho — test env me `API_KEY_MODE=off`

---

## 🔭 Future integrations

Ye sab **abhi nahi**. Aapne kaha simple rakho, aur ye plan wahi karta hai. Par design aisa hoga ki inme se koi bhi baad me add karna ek naya module ho, poora rewrite nahi.

### Future 1 — DB registry + admin panel se rotation

**Kab chahiye:** jab live users aa jaayein aur ek key leak ho. Tab redeploy ka wait mehnga lagega.

**Kya banega:** `models/ApiClient.js` (clientId, label, currentVersion, status, lastUsedAt, createdBy), admin CRUD routes, aur registry lookup ke saath 60s TTL in-process cache.

⚠️ **Cache zaroori hai** — bina uske har request ek DB read hai. Aur ⚠️ **env fallback bhi zaroori hai**: agar registry sirf DB me hui aur Mongo blip hua, to har request 401 degi — ek database hiccup poore platform ka outage ban jaayega, jabki abhi wo sirf slow requests deta hai.

⚠️ **Rotation me overlap window chahiye** — purani aur nayi version dono `n` din tak accept hon. Uske bina rotation ka matlab hai *"ek second ke liye poori API down"*. Leak ke case me overlap **nahi** — turant band.

### Future 2 — HMAC request signing (Layer 2)

Layer 1 ki kamzori: **header copy karo, unlimited replay karo.** Signing wahi band karta hai.

```
clientSecret = HMAC-SHA256(ROOT_SECRET, `secret:${keyId}`)
canonical    = `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256(rawBody)}`

x-td-timestamp / x-td-nonce / x-td-signature
```

Secret wire pe jaata hi nahi — network dekhne wale ko sirf signature dikhta hai jo us ek request ke liye valid hai.

⚠️ **Nonce store process me nahi rakh sakte** (CLAUDE.md: doosra instance start hote hi in-memory set jhoot bolega). Teen raaste: Mongo TTL collection (**har request pe ek extra write** — sabse bada cost), sirf-timestamp window (5 min replay khula, zero cost), ya Redis (sahi jawab, abhi hai nahi).

⚠️ **Multipart uploads ka body hash nahi ban sakta** — `fileUpload` `express.json` se pehle chalta hai, to upload requests pe `rawBody` hoti hi nahi. In pe body-hash chhod ke sirf `method+path+timestamp+nonce` sign karna padega.

**Kahan se shuru:** `internal-jobs` aur `admin-panel` pe. Wahan secret asli me secret hai.

### Future 3 — Device attestation (Layer 3)

Mobile pe **sirf yahi** actually prove karta hai ki request asli, un-tampered app se aayi: **Play Integrity API** (Android) aur **App Attest** (iOS).

**Kab:** jab actual abuse dikhe — scripted claims, voucher farming, ek endpoint pe OTP flood.

⚠️ Pehle se karna over-engineering hai, aur ye emulator / rooted device / kuch OEM builds pe **legit users ko bhi block** kar sakta hai. Isliye iska bhi apna monitor mode chahiye hoga.

### Future 4 — Per-client scopes (third-party partners)

Agar kabhi koi bahari partner (aggregator, reseller, POS) is API ko call karega, to har client ke allowed endpoints define karne padenge — `internal-jobs` ko sab kuch, partner ko sirf 4 endpoints. Ye registry me ek `scopes` array hai.

⚠️ Ye retrofit karna mehnga hai. Isliye [Q6](#-baaki-sawaal) poochh raha hoon — agar jawab "haan, aage plan hai" hai, to `ApiClient` model banate waqt `scopes` field abhi daal denge (khaali), aur baad me sirf enforcement likhna hoga.

### Future 5 — Redis

Rate limit counter aur nonce store dono ko chahiye. CLAUDE.md: counter abhi process me hai, doosra instance = limit double. Jab load balancer aayega tab.

---

## 14. Challenges aur risks — poori list

Ye section doc ka **apna khud ka review** hai. Isme wo teen cheezein bhi hain jo is doc ke pehle draft me **galat** thi.

### 🔴 P0 — Doc ke pehle draft me jo galat tha

#### C1. Rate limiter ka `keyGenerator` — jaise likha tha waise karne se production instantly marta

Pehle draft me likha tha:
```js
keyGenerator: req => req.apiClient?.id ?? req.ip     // 🔴 GALAT
```

Isse **poora customer app ek hi bucket share karega** — saare users milke 3000 requests / 15 min. 200 concurrent users pe wo limit **sekndon me** khatam ho jayegi, aur har customer ko 429 milega. Ye per-IP limit se **kaafi zyada kharab** hai, behtar nahi.

**Sahi shape:**
```js
keyGenerator: req => `${req.apiClient?.id ?? "anon"}:${req.ip}`   // composite
```
…aur alag-alag clients ke liye alag limits, ek hi global number nahi:

| Client | Bucket | Limit |
|---|---|---|
| `customer-app` | clientId + IP | 3000 / 15min (aaj jaisa) |
| `admin-panel` | clientId + IP | 3000 / 15min |
| Bina key wala (monitor mode me) | IP | **bahut kam** — 100 / 15min |

⚠️ Asli faayda ye nahi hai ki limit "clientId pe" lag jaye. Faayda ye hai ki **bina key wale traffic pe alag, sakht limit** lag sake. Wahi wo cheez hai jo aaj bilkul nahi hai.

#### C2. Har failure pe `401` — teeno frontends ko logout loop me daal dega

Pehle draft ki table har case pe `401` deti thi. Problem:

**Har frontend ka HTTP interceptor `401` ko "session expired" maanta hai** — token clear karo, login screen pe bhejo, ya refresh token se retry karo. Agar API key ki wajah se `401` aa raha hai to:

- User ko **logout kar diya jayega** ek aisi problem ke liye jiska uske session se koi lena-dena nahi
- Wo dobara login karega → login call bhi usi `401` se fail hogi → **infinite loop**
- G3 (refresh token) aane ke baad ye aur bura hoga: refresh call bhi `401` degi, aur client refresh-retry-refresh me phas jayega

⚠️ Repo ki apni error table (`CLAUDE.md`) bhi kehti hai: `401` = missing/expired **token**, `403` = invalid token ya permission nahi.

**Sahi:** API key ki har failure `403` ho, plus ek machine-readable `code` (`API_KEY_MISSING`, `API_KEY_INVALID`, `API_KEY_REVOKED`, `API_KEY_ENV_MISMATCH`). Frontend ko explicitly batana hoga: *"`403` + `API_KEY_*` code aaye to logout mat karo — ye build ka problem hai, user ka nahi."*

#### C3. `internal-jobs` client shayad zaroori hi nahi

Maine `jobs/` aur `scripts/` me `axios` / `fetch` khoja — **kuch nahi mila**. Ye sab services ko seedha call karte hain, HTTP se nahi. To `internal-jobs` naam ki key ka koi caller hi nahi hai.

⚠️ **Ek aisi key jo koi use nahi karta, sirf leak surface hai.** Wo `.env` me baithi rahegi, kisi ke laptop pe copy hogi, aur kabhi rotate nahi hogi kyunki kisi ko yaad nahi hoga ki wo hai. Registry me sirf wahi clients daalo jinka ek actual caller maujood hai.

---

### 🟠 P1 — Implementation ke waqt jo phasayenge

| # | Challenge | Kya hoga agar miss hua |
|---|---|---|
| **C4** | **`timingSafeEqual` length mismatch pe throw karta hai** | Ek chhoti/badi key bhejne pe middleware **crash** karega — 500, aur `errorHandler` usko "Unexpected" bana dega. Length pehle check karni hogi. ✅ Repo me precedent already hai: [`helpers/transactions/verifyRazorpayWebhook.js:13`](../helpers/transactions/verifyRazorpayWebhook.js#L13) — wahi pattern copy karo |
| **C5** | **Exempt matching `req.path` pe hai** | `req.path` sirf tab poora path deta hai jab middleware **app level** pe ho. Kisi ne baad me isko router ke andar move kiya to path relative ho jayega, exempt list match karna band kar degi, aur **webhooks 401 dene lagenge** — chupchaap. Plus trailing slash (`/webhook/razorpay/`) aur case bhi normalize karna padega |
| **C6** | **`OPTIONS` — pehle verify karo, maano mat** | `cors()` default me preflight khud handle karke `204` bhej deta hai, to ho sakta hai humara middleware `OPTIONS` pe chale hi na. **Ye assume karna khatarnak hai** — G1 me CORS config badalte hi ye behaviour badal sakta hai. Iska ek explicit test likhna hoga |
| **C7** | **`API_KEY_ROOT_SECRET` missing + `enforce`** | **Har request 403.** Poora platform down, aur ek missing env var jaisa kuch dikhega nahi. Fix: boot pe refuse karo — repo me precedent hai, `index.js` Mongo ke bina start hone se mana kar deta hai. Same treatment |
| **C8** | **Kill switch ke liye restart chahiye** | `API_KEY_MODE=off` env var hai — Render pe uska matlab redeploy/restart hai. Agar enforce flip karne ke baad kuch toota, to recovery time = deploy time. **Behtar:** mode `Setting.security` me bhi rakho (repo me `Setting.security` block already hai, line 701) — admin panel se instant off. ⚠️ Par env override **rehna chahiye**, kyunki agar admin panel hi key ki wajah se API tak nahi pahunch pa raha, to DB wala switch bekaar hai — classic chicken-and-egg |
| **C9** | **Tests** | Har supertest test red ho jayega. `API_KEY_MODE=off` test env me set karna hoga. ⚠️ Money suite **32.6 minute** leta hai — galat env ka pata aadhe ghante baad chalega |
| **C10** | **Postman generators** | ⚠️ `trydood-customer` aur `trydood-vendor` me **captured examples** hain jo generator ko pata nahi (15,499 lines measured). Header add karne ke liye generator edit karna padega, aur galat generator chalane se wo examples delete ho jayenge — command phir bhi success report karegi |
| **C11** | **morgan me `clientId`** | Custom token banana padega. Chalega (morgan response finish pe log karta hai, tab tak `req.apiClient` set ho chuka hoga) — par **log format badal jayega**, to koi bhi downstream log parser / CloudWatch filter toot sakta hai |
| **C12** | **`.env` aur `.env.example` ka drift** | `.env` gitignored hai. Naya var sirf `.env.example` me gaya to deploy pe wo missing hoga — aur C7 wala failure milega |
| **C13** | **Frontend build pipeline** | Key har frontend ke CI/CD env me jaani hai. ⚠️ CI logs me env vars print ho jaana bahut aam hai. Aur React Native / web bundle me `.env` build ke waqt **bundle ke andar inline** ho jaata hai — wo public hai, isme koi bachav nahi (§3 dobara padhein) |

---

### 🟡 P2 — Monitor mode ke apne issues

| # | Challenge | Detail |
|---|---|---|
| **C14** | **Monitor ke logs padhega kaun?** | Raw log lines koi nahi padhta. Chahiye: ek in-memory counter + **daily summary** admin notice. Repo me `sendQuietly` + admin notification ka pattern already hai (reap alerts isi tarah jaate hain) |
| **C15** | **Log flood** | Agar koi bot loop me hit kar raha hai to monitor har request log karega. Dedupe (path+client per minute) ya sampling chahiye |
| **C16** | **Monitor sab kuch nahi pakadta** | Wo sirf *aaye hue* traffic ke baare me batata hai. Ek cron jo mahine me ek baar chalta hai, ya ek QA flow jo test window me nahi chala — wo list me nahi aayega, aur enforce ke baad toot jayega |
| **C17** | **Monitor mode me limit dheeli hi rehti hai** | Monitor me hum reject nahi karte, to bina key wale traffic pe C1 wali sakht limit bhi nahi lag sakti. Matlab monitor phase me **security ka faayda zero hai** — wo sirf ek discovery tool hai. Usko security milestone mat samjhiye |

---

### 🔵 Future me jo issues aayenge

| # | Issue | Kyun aur kab |
|---|---|---|
| **C18** | 🔴 **Root secret leak = sab kuch ek saath dead** | Derived-key design ki sabse badi structural kamzori. Root leak hua to **koi partial recovery nahi** — naya root, aur teeno frontends ka simultaneous redeploy, us beech API sabke liye down. Mitigation: root secret CI logs se bahar rakho, aur aage `ROOT_SECRET_NEXT` support add karo taaki rolling migration ho sake |
| **C19** | **Revoke ke liye redeploy** | Env registry ka trade-off (§5). Testing me theek. Jab live users honge aur ek key leak hogi, tab ye ghante kha jayega → [Future 1](#future-1--db-registry--admin-panel-se-rotation) |
| **C20** | 🔴 **Pehla public app release scheme ko hamesha ke liye lock kar deta hai** | Store pe release hone ke baad, key **format**, **header ka naam**, ya **error code** badalne ka matlab hoga har purane build ko todna — aur wo users turant update nahi kar sakte. ⚠️ **Isliye ye teen cheezein abhi final karni hain**, launch se pehle. Yahi asli wajah hai ki `v1` abhi format me daal rahe hain |
| **C21** | **APK se key nikalna — ye hoga hi** | Sawaal "agar" nahi, "kab" hai. Uske baad ek scraper ke paas valid key hogi. Us din kya karenge? Ek incident playbook chahiye: pata kaise chalega (per-client traffic anomaly), turant kya (per-client rate limit girao), permanent kya ([Future 3 — attestation](#future-3--device-attestation-layer-3)) |
| **C22** | 🔴 **G3 (refresh token) × API key = do alag `401` sources** | C2 ka bada version. Jab refresh flow aayega, client ko *"access token expire hua"* aur *"API key ka problem hai"* me farq karna hoga. Nahi kar paya to **infinite refresh loop** — client refresh maangta rahega, har baar fail hoga, aur server pe load banata rahega. **Isliye C2 (403 + code) abhi fix karna zaroori hai, G3 se pehle** |
| **C23** | **Multi-instance** | Monitor counters process me hain → 2 instances = aadha data har jagah. Rate limit counter bhi process me hai → CLAUDE.md ka jaana-pehchana "limit double" problem. Dono ka jawab Redis hai ([Future 5](#future-5--redis)) |
| **C24** | **Postman collection bahar gaya to key bahar gayi** | Agar kabhi vendor/partner ko collection di, to usme embedded key bhi chali jayegi. Isliye ek alag `postman-dev` client jo alag se revoke ho sake — production key kabhi collection me nahi |
| **C25** | **Partner scopes ka retrofit** | Baad me `scopes` add karna matlab har existing client ko migrate karna. [Q6](#-baaki-sawaal) ka jawab "haan" hai to field abhi (khaali) daal dena sasta hai |
| **C26** | **Health/uptime monitors** | Aaj `/` exempt hai. Kisi ne kabhi kisi doosre endpoint pe monitor lagaya (ya Render ka health path badla) to wo chupchaap 403 dene lagega aur alert bajta rahega |

---

### ⚫ Sabse bada risk: ye net-negative bhi ho sakta hai

Do tareeke se:

1. **False sense of security.** *"API key laga di, backend safe hai"* maan ke G1 (CORS), G2 (per-account limits), G3 (session revoke) ko peeche daal dena. ⚠️ Ye teeno **API key se zyada** protect karte hain. Khaas taur pe **G1** — aaj `cors()` bilkul open hai, aur API key uske against kuch nahi karti (§12).

2. **Outage surface.** Ye middleware **100% requests** pe chalega, aur wo casual traffic rokta hai — determined attacker nahi. Matlab hum har request pe ek naya failure point add kar rahe hain, ek aise faayde ke liye jo seemit hai. **Isi wajah se** `off` kill switch, boot-time validation (C7), aur `monitor` phase non-negotiable hain — wo isko net-positive banate hain.

---

## ❓ Baaki sawaal

**A. Q4 me contradiction hai — confirm kar dijiye**
Aapne *"Sirf API key, baaki kuch nahi"* aur saath me G1, G2, G3 **teeno** select kiye. Maine ye maan ke doc likha hai ki **API key core hai aur G1–G3 uske baad phases me aayenge (P4-P6)**. Agar aap sach me sirf API key chahte the aur G1-G3 galti se select ho gaye, to bata dijiye — §12 aur P4-P6 nikaal doonga.

**B. Q5 — Environments**
Production ke alawa staging/dev alag deployments hain? `env` key ke andar hai, to har deployment ka apna `API_KEY_ROOT_SECRET` chahiye — aur har environment ke liye alag keys generate karke frontend team ko deni hongi. Agar sirf prod + local hai to ye simple hai.

**C. Q6 — Third-party**
Aage kabhi koi bahari partner ye API call karega? Sirf haan/nahi chahiye — [Future 4](#future-4--per-client-scopes-third-party-partners) me likha hai ki iska asar kya hai.

**D. Frontend keys kaise pahunchengi?** *(chhota par zaroori)*
Key generate karke frontend team ko kaise doonga — ye tay karna hai. ⚠️ **WhatsApp / email / Slack pe plain text me nahi.** Ek password manager, ya aap khud CLI chalake apne haath se dein. Ye ek naya secret hai aur usko waise hi treat karna chahiye jaise Razorpay ka secret.
