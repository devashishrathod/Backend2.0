# Postman — Security & API Changes (2026-08-26)

Sirf wo endpoints jo is round me **badle**, plus 6 naye endpoints. Baaki endpoints
`trydood-brand-verification` aur `trydood-subscription` collections me hain.

| File | Kya hai |
|---|---|
| `trydood-security-changes.postman_collection.json` | Collection — 12 folders, 49 requests, 106 saved examples |
| `environments/security-local.postman_environment.json` | `http://localhost:8080/trydood/v1` |
| `environments/security-staging.postman_environment.json` | `https://backend2-0-4v4i.onrender.com/trydood/v1` |
| `environments/security-production.postman_environment.json` | Production — **use se pehle confirm karein** |
| `generate-security-collection.js` | Sab kuch regenerate karta hai |

Companion docs: [`../docs/security_fix_plan.md`](../docs/security_fix_plan.md) ·
[`../docs/security_findings.md`](../docs/security_findings.md)

---

## Import

1. Postman → **Import** → `trydood-security-changes.postman_collection.json`.
2. `environments/` se apna environment import karein.
3. Top-right dropdown se **select** karein — bina iske kuch nahi chalega (pre-request
   script warning deta hai agar `base_url` set na ho).

## Secrets bharein

`secret` type wali variables **khaali ship hoti hain** — credentials git me nahi jaate.

| Variable | Kya set karein |
|---|---|
| `admin_password` | Aapke admin account ka password |
| `admin_email` | Default `admin@trydood.com` |
| `vendor_whatsapp` | Test vendor ka 10-digit number |
| `customer_whatsapp` | Test customer ka 10-digit number |
| `otp` | Kuch bhi 6-digit — OTP abhi verify nahi hota |

## Pehla admin — API se nahi banta

`/auth/register` ab `isAdmin` ke peeche hai, to bootstrap CLI se hota hai:

```bash
node scripts/seedAdmin.js \
  --email admin@trydood.com --password 'Str0ngPass1' \
  --name "Admin User" --username admin_user --mobile 9800000000 --apply
```

`--apply` ke bina wo dry run hai.

## Token capture — copy-paste nahi karna

`00 — Auth` folder tokens khud environment me likhta hai:

| Ye chalayein | Ye set hota hai |
|---|---|
| **Login as Admin (password)** | `admin_token`, `admin_user_id` |
| **Vendor WhatsApp — Send OTP** | `brand_id`, `is_first` |
| **Vendor WhatsApp — Verify OTP** | `vendor_token`, `brand_id` |
| **Customer WhatsApp — Verify OTP** | `customer_token` |

Har request pehle se sahi token use karti hai — admin routes `{{admin_token}}`, vendor
routes `{{vendor_token}}`, customer routes `{{customer_token}}`.

`section_id`, `location_id`, `voucher_id`, `sub_brand_id`, `legal_id` — ye aapko khud
bharni hongi, ya doosri collections se aati hain.

---

## Folder map

| Folder | Kya cover karta hai |
|---|---|
| `00 — Auth (token capture)` | Login flows — `isFirst` fix, `isProfileComplete`, naya admin block, password strip |
| `01 — Auth (gates & password flow)` | `register` ab `isAdmin`, password flow sirf ADMIN |
| `02 — Users (IDOR fixed)` | `?userId` param hataya |
| `03 — Brands` | ⭐ Naya customer endpoint, `/brands/get` ab vendor+admin only |
| `04 — Showcase` | Brand scoping wapas, ownership check, admin support |
| `05 — Locations` | Customer upsert scoping, ownership check, role gates |
| `06 — Naye role gates` | Banners, tickers, features, work hours, outlets, voucher versions, follows |
| `07 — Legal (broken → fixed)` | Create endpoints jo **kabhi kaam hi nahi karte the** |
| `08 — Vouchers` | `FIXED` discount ab calculate hota hai |
| `09 — Pricing` | ⭐ Convenience fee slabs + no-offer fallback (`400` → `200`) |
| `10 — Admin curation` | ⭐ Suggested vouchers + top brands — pin / unpin / reorder + admin lists |
| `11 — Customer lists` | ⭐ Suggestions & Top Brands tabs, voucher banner fields, naya brand directory |

Har request ke description me ek **🔄 Kya badla** banner hai — usse pata chal jayega ki
wo request is collection me kyun hai.

---

## Run karne se pehle jaan lein

- **List endpoints empty pe `404` dete hain**, empty array nahi — shared `pagination`
  utility throw karti hai. Isko empty state samajhein, error nahi.
- **WhatsApp OTP abhi verify nahi hota** — deliberate aur deferred. Koi bhi 6-digit
  chalega. Jab wo uncomment hoga to `Invalid OTP! Please try again.` aana shuru hoga.
- **`coordinates` `[longitude, latitude]`** order me hain — GeoJSON standard, jo maps
  APIs se ulta hai. Indore = `[75.8937, 22.7533]`, `[22.7533, 75.8937]` **nahi**.
- **`/brands/get` ke lookup fields singular hain** — `pan` (not `pans`), `firstSubBrand`
  (not `subbrands`). Docs me pehle galat likha tha.
- **`workHours` me din top-level keys hain** — koi `workingHours` wrapper nahi.
- **Kuch list endpoints khud scope nahi karte** — `subBrands/get-all` aur
  `locations/getAll` pe `brandId` bhejna zaruri hai, warna platform-wide data aata hai.

## Frontend ko batane wale changes

| Change | Kya karna hai |
|---|---|
| `/auth/register` me `role` **required** | Explicitly bhejein — pehle default `ADMIN` tha |
| Naya `isProfileComplete` field | Routing me use kar sakte hain — additive hai |
| `isFirst` ka matlab badla | Ab "OTP verify nahi hua" — retry pe bhi `true` |
| Password endpoints customer/vendor pe `422` | Message: *"Password sign-in is only available for admin accounts…"* |
| `?userId` param kaam nahi karega | Token se hi user resolve hota hai |
| `locations/upsert` body ka `userId` ignore | Bhejna band karein |
| Customer app `/brands/get` pe `403` | Naye `/brands/customer/get/:brandId` pe shift karein |
| `showcase/section/get-all` ab `brandId` leta hai | Vendor optional, admin narrowing filter |
| Legal create me `type` **required** | `"VENDOR"` / `"CUSTOMER"` jaisa audience marker |
| Preview me `"No eligible offer found…"` **ab nahi aata** | `200` + `offerApplied: false` handle karein — offer section chhupa dein |
| Naya `pricing` block | `pricing.payableAmount` charge karein. **Fee khud calculate mat karein** |
| Voucher rows pe `bannerType` / `bannerUrl` | Dono saath aate hain — banner na ho to dono `null` |
| Voucher rows pe `isSuggested` | Badge/highlight ke liye |
| List response pe top-level `isOutOfRange` | Sirf Suggestions tab pe `true` ho sakta hai — "aas-paas nahi hain" note dikhayein |
| `suggestedOnly` / `topOnly` params | Tab aur "view more" ek hi endpoint se. **Dedupe mat karein** — rows repeat nahi hote |

---

## Regenerate

```bash
node postman/generate-security-collection.js
```

`server2.0/` se chalayein. Collection aur teeno environment files rewrite ho jaati hain.

**JSON hand-edit mat karein** — enums `constants/`, `constants/voucher.js` aur
`constants/showcase.js` se seedhe padhe jaate hain, to hand-edit karne se collection API
ke baare me jhooth bolna shuru kar deta hai. Naya case add karna ho to generator me
add karein aur re-run karein.
