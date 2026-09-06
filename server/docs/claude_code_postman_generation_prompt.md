# Docs aur Postman ko API ke saath kaise sync rakhein

> ⚠️ **Ye file pehle "ek nayi Postman collection generate karo" wala prompt thi.**
> Wo ab galat hidayat hai. Teen collections aur teen docs maujood hain, 219/219
> routes cover karti hain, aur unhe **update** kiya jaata hai — naya nahi banaya
> jaata. Chauthi collection banane se coverage nahi badhti; wo bas ek aur jagah
> ban jaati hai jo drift karegi.

---

## Ek line me

```bash
node scripts/verifyApiCoverage.js
```

Ye batata hai ki koi endpoint doc ya collection se chhoot to nahi gaya. `0`
matlab sab theek; `1` matlab kya kya missing hai, naam lekar.

Ek pre-commit hook (`.githooks/pre-commit`) ise tab chalata hai jab commit me
`routes/`, teen docs, ya `postman/` chhua ho.

```bash
git config core.hooksPath .githooks   # ek baar
```

---

## Naya endpoint jodne par

`CLAUDE.md` ke **Adding an Endpoint** me 9 step hain. Aakhri teen ye:

7. `docs/endpoints_category.md` me row
8. Jis doc me uska gate ijazat deta hai, wahan section
9. Matching collection me request — **aur ek asli captured example**

### Kaunsa doc, kaunsi collection

Gate se tay hota hai, isse nahi ki kahan achha lagta hai:

| Gate | Doc | Collection |
|---|---|---|
| `isCustomer` | customer | `trydood-customer` |
| `isVendor` · `isVendorOrSubVendor` | vendor | `trydood-vendor` |
| `isAdmin` | admin | `trydood-admin` |
| `isVendorOrAdmin` · `isBrandSideOrAdmin` | **vendor + admin** | vendor only |
| `PUBLIC` · `optionalAuth` · `verifyJwtToken` | koi ek | koi ek |

---

## Poora cycle — isi kram me

⚠️ **Generator environment ko khaali values ke saath dobara likhta hai**, isliye
seeding uske *baad* aani chahiye. Ulta chalane par capture khaali `{{…}}` bhejta
hai — aur wo khaali string nahi hoti, Postman literal braces bhejta hai, request
router ke catch-all par girti hai, aur jawab `404 Invalid API` aata hai. Wo
refusal routing bug jaisi dikhti hai aur uska missing value se koi lena-dena
nahi lagta.

```bash
# 1. sirf us generator ko chalao jiska source badla hai
node postman/generate-<panel>-collection.js

# 2. fixtures — shadow indexes reap karta hai aur ids environment me likhta hai
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply

# 3. server usi database par (alag shell; jobs band, warna sweeps beech me chalte hain)
MONGO_URL="<...>/Trydood2_postman" ENABLE_JOBS=false npm start

# 4. capture — har response wapas usi file me example ban jaata hai
node postman/lib/capture-examples.js \
  postman/trydood-<panel>.postman_collection.json \
  postman/environments/<panel>-local.postman_environment.json

# 5. aur phir jaanch
node scripts/verifyApiCoverage.js
node postman/lib/validate-collection.js \
  postman/trydood-<panel>.postman_collection.json \
  postman/environments/<panel>-local.postman_environment.json
```

---

## Teen jaal jo yahan pehle se lag chuke hain

### 1. Generator captured examples **mita deta** hai

`node postman/generate-<panel>-collection.js` poori file dobara likhta hai.
Generator sirf haath se likhe examples jaanta hai — live capture se aaye uske
source me hain hi nahi.

Naapa gaya: bina soche do collections regenerate karne par **15,499 line delete**
hui, yaani 237 captured examples, aur command "✅ wrote" bolkar khatam ho gayi.

**Isliye:** `git diff --stat postman/` zaroor dekho. **Delete ki ginti insert se
badi ho to ruk kar socho**, aur regenerate ke baad step 2-4 dobara chalao.

### 2. Do capture run ke beech **dobara seed karo**

Collections jaan-boojh kar rows delete karti hain — ek banner, ek ticker, ek
category — aur kai ek settlement ya refund ko uske state machine me aage badha
deti hain. Bina fresh seed ke doosra capture un fixtures par girta hai jo pehle
ne khatam kar diye.

⚠️ Aur wo failure kahin **aur** dikhti hai. Ek `Set Password` request admin ka
password badal deti thi, to *agla* run login par `401` deta tha aur teeno sau
requests auth ki taraf ishaara karti hui gir jaati thin — us request ki taraf
nahi jisne password hilaya tha.

### 3. Seeder ka clear wo bhi hataaye jo **collection** banati hai

Seeder apne marker (`uniqueId: /PMFX/`) se saaf karta tha. Par collections asli
API se rows banati hain, jinhe generated id milti hai — marker unhe kabhi nahi
dekhta, aur har capture run par ek aur jud jaata hai.

Naapa gaya: **28 leftover brands**, jinme se 18 customer collection ke
brand-directory example me aa rahe the, aur ek ka `brandName` tha hi nahi — usi
ne aakhirkar us folder ki assertion todi. Isi tarah seeded-number users next
seed ko `user_whatsappNumber_role_unique` par maar dete the.

**Isliye:** jo collection banati hai, use **value ke apne marker** se clear karo
(`whatsappNumber: /^97000000\d{2}$/`, `code: "LAUNCH20"`,
`brandName: /^postman onboarding brand/`) — us field se nahi jo seeder control
karta hai. Seeder `Trydood2_postman` ke bahar chalne se refuse karta hai, to
wahan chauda filter surakshit hai.

---

## Quality bar

- Har request par **captured** example — haath se likha nahi. Bina example ke
  request ka matlab hai wo kabhi chali hi nahi.
- Assertion API ke baare me sach bole. Yahan teen inherited assertions mili jo
  galat thin: `data` ko array padhna jab `pagination()` `{…, data}` deta hai;
  `limits.subBrandsLimit` jab shape `limits.subBrands.limit` hai; aur ek
  `companyStateCode` `"23"` maangti thi jab request ka apna GSTIN `33…` bhejta
  hai. Do fail ho rahi thin, ek **chup-chaap pass** — aur wo teeno se bura hai.
- Enum values aur limits `constants/` se aayein, hardcode nahi.
- Query parameter ki `description` me enum likha ho (`"OPEN | WON | LOST"`,
  `"Max 100"`) — wahi cheez panel developer collection kholkar dhoondhta hai.
- Jo request ek fixture khatam karti hai, uske saath ek **restore** request ho
  (password, notification preferences, brand status — teeno ke paas hai).
