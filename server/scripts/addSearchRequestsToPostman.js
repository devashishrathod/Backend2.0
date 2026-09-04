/**
 * Add the global customer search endpoints to the customer collection.
 *
 * ⚠️ **Deliberately not a generator.** `generate-customer-collection.js` rewrites
 * the whole file and only knows about hand-written examples — the 132 captured
 * from live runs are not in its source, so a regenerate deletes them and still
 * reports success. That happened once, measured at 15,499 lines across two
 * collections.
 *
 * Same guards as `addClaimRequestsToPostman.js` and
 * `addRefundRequestsToPostman.js`:
 *
 *  1. **Byte-exact round-trip**, checked before writing. These files use CRLF;
 *     re-serialising them with LF reformats every line and buries the real change
 *     in a 20,000-line diff nobody reviews.
 *  2. **Captured example count**, asserted unchanged. Inserting must never cost
 *     an example — they cannot be recovered from source.
 *  3. **Folder numbering**, with a duplicate check. The claim folders once left
 *     two folders sharing a number: Postman shows them in array order, so
 *     nothing errors and nobody notices.
 *
 * The environment file gets the one new variable the folder captures, under the
 * same round-trip guard.
 *
 *   node scripts/addSearchRequestsToPostman.js           # what would change
 *   node scripts/addSearchRequestsToPostman.js --apply   # change it
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "postman");
const COLLECTION = "trydood-customer.postman_collection.json";
const ENVIRONMENT = path.join(
  "environments",
  "customer-local.postman_environment.json",
);

const url = (raw, pathParts, query = []) => ({
  raw: `{{base_url}}${raw}`,
  host: ["{{base_url}}"],
  path: pathParts,
  ...(query.length ? { query } : {}),
});

const bearer = (token) => ({
  type: "bearer",
  bearer: [{ key: "token", value: `{{${token}}}`, type: "string" }],
});

const noAuth = { type: "noauth" };

const tests = (code, extra = []) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("HTTP ${code}", function () {`,
      `  pm.response.to.have.status(${code});`,
      "});",
      "",
      `pm.test("${code < 300 ? "success" : "failure"} envelope", function () {`,
      "  const b = pm.response.json();",
      `  pm.expect(b.success, "success flag").to.eql(${code < 300});`,
      '  pm.expect(b.message, "message").to.be.a("string").and.not.empty;',
      "});",
      ...(extra.length ? ["", ...extra] : []),
    ],
  },
});

/** Every section, in the order the API returns them. */
const SECTION_TABLE = [
  "| Section | Source | Location chahiye? |",
  "|---|---|:-:|",
  "| `BRAND` | `Brand.brandName` | ❌ |",
  "| `VOUCHER` | `VoucherVersion` → current published version | ✅ |",
  "| `CATEGORY` · `SUB_CATEGORY` | `name` | ❌ |",
  "| `AREA` | live outlets ke `Location.city` | ❌ |",
].join("\n");

const ITEM_ENVELOPE = [
  "Har row ka ek hi shape hota hai, chahe wo kisi bhi type ka ho:",
  "",
  "```jsonc",
  "{",
  '  "type": "BRAND",',
  '  "id": "…",',
  '  "title": "Domino\'s Pizza",',
  '  "subtitle": "Food & Beverages · 12 outlets",',
  '  "image": "https://…",',
  '  "meta":   { /* type ke hisaab se */ },',
  '  "target": { "screen": "BRAND_PROFILE", "endpoint": "/brands/customer/get/…" }',
  "}",
  "```",
  "",
  "> `target` **server bhejta hai**, app hardcode nahi karti. Detail route kal badla",
  "> to ek jagah badlega, har shipped app version me nahi. Yahi `seeAll` ke saath bhi —",
  "> section apna \"see all\" endpoint aur uske params khud batata hai.",
].join("\n");

// ---------------------------------------------------------------------------
const items = [
  {
    name: "Search — guest, bina location ⭐",
    event: [
      tests(200, [
        'pm.test("sections aate hain, khaali bhi", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d.sections, "sections").to.be.an("array").with.length.above(0);',
        '  pm.expect(d).to.have.property("totalResults");',
        "});",
        "",
        'pm.test("bina location voucher section skip hota hai, chupke se nahi", function () {',
        "  const v = pm.response.json().data.sections.find((s) => s.type === \"VOUCHER\");",
        '  pm.expect(v, "VOUCHER section").to.exist;',
        '  pm.expect(v.locationRequired, "locationRequired").to.eql(true);',
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/search?q=noida", ["search"], [{ key: "q", value: "noida" }]),
      auth: noAuth,
      description: [
        "**Access:** 🌐 `optionalAuth` — token ke bina bhi chalta hai. Guest home screen ka",
        "search box seedha yahi maarta hai.",
        "",
        SECTION_TABLE,
        "",
        "⚠️ **`VOUCHER` section location ke bina khaali aata hai, gayab nahi hota** — uspe",
        "`locationRequired: true` hota hai. Voucher pipeline `$geoNear` se shuru hoti hai aur",
        "`$geoNear` pipeline ka pehla stage hi ho sakta hai, to \"bina location voucher search\"",
        "ek filter nahi — poori alag pipeline hoti. Section ko chhupa dena ya poori request",
        "422 kar dena dono galat: pehle me app ko pata hi nahi chalta ki kyun kuch nahi aaya,",
        "doosre me location permission deny karne wala guest brand ka naam bhi nahi dhoondh",
        "sakta — jiske liye location kabhi chahiye hi nahi thi.",
        "",
        ITEM_ENVELOPE,
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Search — location ke saath (saare sections)",
    event: [
      tests(200, [
        'pm.test("location mili to voucher section bharta hai", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d.hasLocation, "hasLocation").to.eql(true);',
        "  const v = d.sections.find((s) => s.type === \"VOUCHER\");",
        '  pm.expect(v.locationRequired, "locationRequired").to.eql(false);',
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/search?q=off&latitude=22.7533&longitude=75.8937&limit=3",
        ["search"],
        [
          { key: "q", value: "off" },
          { key: "latitude", value: "22.7533" },
          { key: "longitude", value: "75.8937" },
          { key: "limit", value: "3" },
        ],
      ),
      auth: noAuth,
      description: [
        "`latitude` aur `longitude` **saath me** hi bhejein — akela ek bhejne pe `422`.",
        "",
        "Signed-in customer inhe **chhod** sakta hai: uska saved address apne aap use ho jaata",
        "hai, wahi resolver jo voucher feed use karta hai (`resolveCustomerCoordinates`). Guest",
        "ke paas saved address hota hi nahi, to usse coordinates khud bhejne padte hain.",
        "",
        "⚠️ `limit` **per section** hai, poore response ka nahi — 3 ka matlab har section me",
        "teen rows, kul teen nahi.",
        "",
        "⚠️ Voucher matching me offer ka title bhi shaamil hai. \"buy 1 get 1\" kisi voucher ke",
        "**naam** me nahi hota — wo offer hai, `version.offers[].title` par. Pehle sirf naam",
        "match hota tha, to customer jo phrase sach me type karta hai wo kuch nahi dhoondh",
        "paata tha.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Search — signed in, history me save karo (commit)",
    event: [
      tests(200, [
        "// ── history ki id capture, taaki agla request usko delete kar sake ──",
        "if (pm.response.code < 300) {",
        "  pm.sendRequest({",
        '    url: pm.environment.get("base_url") + "/search/history",',
        '    method: "GET",',
        '    header: { Authorization: "Bearer " + pm.environment.get("customer_token") },',
        "  }, function (err, res) {",
        "    if (err) return;",
        "    try {",
        "      const rows = res.json().data;",
        '      if (rows && rows.length) pm.environment.set("search_history_id", String(rows[0]._id));',
        "    } catch (e) {}",
        "  });",
        "}",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/search?q=pizza&commit=true",
        ["search"],
        [
          { key: "q", value: "pizza" },
          { key: "commit", value: "true" },
        ],
      ),
      auth: bearer("customer_token"),
      description: [
        "**`commit=true` ke bina kuch save nahi hota.** Search box har keystroke pe call",
        "karta hai; har call save karne se recent list `p, pi, piz, pizz, pizza` ban jaati",
        "hai aur feature na hone se badtar ho jaata hai. App ye flag tab bhejti hai jab",
        "customer Enter dabaye ya kisi result pe tap kare.",
        "",
        "| Caller | `commit=true` pe kya hota hai |",
        "|---|---|",
        "| Signed-in customer | Row upsert — dobara search par nayi row nahi, `searchCount` badhta hai |",
        "| Guest | Kuch nahi, aur koi error bhi nahi — uski history device par hai |",
        "| Vendor / admin preview | Kuch nahi — unka `Customer` record hota hi nahi |",
        "",
        "⚠️ History likhna search ko **kabhi fail nahi karta**. Results jawab hain, history",
        "ek side effect. Do device ki race, index build — kuch bhi ho, customer ko results",
        "milte hain aur error sirf log me jaata hai.",
        "",
        "⚠️ `Pizza`, `pizza` aur `pizza  hut` vs `pizza hut` ek hi row hain — dedupe",
        "lowercase + whitespace-collapsed `normalizedQuery` par hota hai.",
      ].join("\n"),
    },
    response: [],
  },
];

items.push(
  {
    name: "Ek hi type, paginated — Areas ka \"see all\"",
    event: [
      tests(200, [
        'pm.test("single-type shape", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d.type, "type").to.eql("AREA");',
        '  pm.expect(d, "items").to.have.property("items");',
        '  pm.expect(d, "no sections in this mode").to.not.have.property("sections");',
        '  pm.expect(d, "totalPages").to.have.property("totalPages");',
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/search?q=ind&type=AREA&page=1&limit=20",
        ["search"],
        [
          { key: "q", value: "ind" },
          { key: "type", value: "AREA" },
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
        ],
      ),
      auth: noAuth,
      description: [
        "`type` dene se **response ka shape badal jaata hai**: `sections[]` ki jagah ek",
        "`items[]` aur `total` / `totalPages` / `page` / `limit`. Row ka envelope wahi rehta",
        "hai, to app ka row component dono mode me ek hi hai.",
        "",
        "| Type | \"See all\" kahan bhejein |",
        "|---|---|",
        "| `AREA` | **Yahin** — aur koi raasta hai hi nahi |",
        "| `BRAND` · `VOUCHER` | Behtar hai `/brands/customer/get-all` · `/vouchers/customer/get-all` — wahan filter aur sort presets hain |",
        "| `CATEGORY` · `SUB_CATEGORY` | Dono chalega |",
        "",
        "AREA akela type hai jiska apna listing endpoint nahi hai: wo kisi collection ka",
        "listing nahi, live outlets ke addresses ka grouped result hai. Isiliye ye mode",
        "maujood hai.",
        "",
        "⚠️ **AREA pe tap karne se koi detail page nahi khulta.** Row me us jagah ka centroid",
        "(`meta.latitude` / `meta.longitude`) aata hai aur app apni location wahan set kar",
        "deti hai — home feed, voucher search sab pehle se `$geoNear` par hain, to sab apne",
        "aap us area ke ho jaate hain. Koi naya filter, koi `city` param kahin nahi.",
        "",
        "Centroid us area ke saare outlets ka **औसत** hai, kisi ek dukaan ka pin nahi — warna",
        "\"Indore\" ka matlab ek gali ban jaata aur wahan switch karne par aadhe area ke offers",
        "25 km ki radius se bahar chhoot jaate.",
        "",
        "⚠️ `meta.city` **free text** hai, normalise nahi hota. \"Andheri West\" aur",
        "\"andheri west\" ek row hain (lowercase + trim), par \"Andheri  West\" — do space —",
        "alag reh jaata hai. Search tootti nahi; ek jagah do rows ki tarah dikh sakti hai.",
        "",
        "⚠️ `id` (`\"indore|madhya pradesh\"`) **synthetic** hai — list key ke liye. Ise kisi",
        "endpoint me id ki tarah bhejna nahi hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Sirf kuch sections chahiye — types filter",
    event: [
      tests(200, [
        'pm.test("sirf maange gaye sections aate hain", function () {',
        "  const types = pm.response.json().data.sections.map((s) => s.type);",
        '  pm.expect(types, "sections").to.have.members(["BRAND", "CATEGORY"]);',
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/search?q=food&types=BRAND,CATEGORY",
        ["search"],
        [
          { key: "q", value: "food" },
          { key: "types", value: "BRAND,CATEGORY" },
        ],
      ),
      auth: noAuth,
      description: [
        "Comma-separated. Na bhejein to saare sections aate hain.",
        "",
        "⚠️ `types` (plural, kaunse sections) aur `type` (singular, mode switch) **alag**",
        "cheezein hain. Dono ek saath bhejne pe `422` — chup-chaap ek ko ignore karna wo",
        "galti hai jise koi debug nahi kar paata.",
        "",
        "Ye latency ke liye hai: har section parallel chalta hai, par jo section aap render",
        "hi nahi kar rahe uske liye database se poochhne ka koi kaaran nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Bahut chhoti query — 422",
    event: [tests(422)],
    request: {
      method: "GET",
      header: [],
      url: url("/search?q=o", ["search"], [{ key: "q", value: "o" }]),
      auth: noAuth,
      description: [
        "Minimum `Setting.customer.search.minQueryLength` se aata hai (default **2**), Joi se",
        "nahi — admin ise badal sakta hai aur Joi schema require ke waqt ek baar banti hai, to",
        "usme value bake karne se har baad ka badlaav chup-chaap ignore ho jaata.",
        "",
        "App ko is se pehle call hi nahi karni chahiye. Ek character poore platform ke brands,",
        "vouchers, categories aur har outlet ke address pe match karta hai — aur lagbhag sab",
        "kuch laut ke aata hai, jisse kisi ka bhala nahi hota.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "page bina type ke — 422",
    event: [tests(422)],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/search?q=pizza&page=2",
        ["search"],
        [
          { key: "q", value: "pizza" },
          { key: "page", value: "2" },
        ],
      ),
      auth: noAuth,
      description: [
        "Overview me paanch sections hain — \"page 2\" ka koi matlab hi nahi banta.",
        "",
        "Ise chup-chaap ignore karna sasta lagta hai par ek app developer ki poori dopahar le",
        "leta hai: `page=2` bhejo, page 1 wapas aaye, aur kahin koi error na ho. Refusal me",
        "seedha likha hai ki `page` sirf `type` ke saath chalta hai.",
      ].join("\n"),
    },
    response: [],
  },
);

items.push(
  {
    name: "Meri recent searches",
    event: [
      tests(200, [
        'pm.test("khaali history bhi 200 hai, 404 nahi", function () {',
        '  pm.expect(pm.response.json().data, "data").to.be.an("array");',
        "});",
        "",
        "if (pm.response.code < 300) {",
        "  try {",
        "    const rows = pm.response.json().data;",
        '    if (rows.length) pm.environment.set("search_history_id", String(rows[0]._id));',
        "  } catch (e) {}",
        "}",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/search/history", ["search", "history"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `isCustomer`",
        "",
        "Newest first, `Setting.customer.search.historyLimit` (default **20**) tak. Us cap se",
        "purani rows har commit ke baad soft-delete ho jaati hain.",
        "",
        "⚠️ **Khaali list `200` hai, `404` nahi.** Baaki list endpoints yahan 404 dete hain",
        "(shared `pagination` throw karti hai), par jis customer ne abhi tak kuch search hi",
        "nahi kiya wo bilkul normal haal me hai — wahan 404 dena pehle din hi error screen",
        "dikha dega.",
        "",
        "⚠️ Guest ko yahan `401` milta hai, khaali list nahi. Uski history device par hai;",
        "khaali array dena \"aapne kuch search nahi kiya\" ka daava hota, jo sach nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek entry hataao",
    event: [tests(200)],
    request: {
      method: "DELETE",
      header: [],
      url: url("/search/history/{{search_history_id}}", [
        "search",
        "history",
        "{{search_history_id}}",
      ]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `isCustomer` — aur `customerId` **filter ka hissa** hai, baad me check",
        "nahi hota. Bina uske koi bhi signed-in customer kisi aur ki row ki id bhej kar uski",
        "history ek-ek karke mita sakta tha.",
        "",
        "⚠️ Kisi aur ki row par **`404`**, `403` nahi. \"Ye hai to sahi, par aapka nahi\" khud",
        "ek leak hai — usse pata chal jaata hai ki id asli hai.",
        "",
        "⚠️ Hataya hua term **dobara search ho sakta hai** aur nayi row ban jaata hai (count 1",
        "se). Isiliye unique index **partial** hai (`isDeleted: false`) — blanket hota to",
        "upsert soft-deleted row se takra kar duplicate-key error deta, ek aise field par",
        "jise customer ne kabhi chhua hi nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Poori history clear",
    event: [
      tests(200, [
        'pm.test("deletedCount aata hai", function () {',
        '  pm.expect(pm.response.json().data, "data").to.have.property("deletedCount");',
        "});",
      ]),
    ],
    request: {
      method: "DELETE",
      header: [],
      url: url("/search/history", ["search", "history"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `isCustomer`",
        "",
        "⚠️ Pehle se khaali history par bhi `200` aur `deletedCount: 0`. Customer ne kaha",
        "\"meri history hata do\" aur history hat chuki hai — \"hataane ko kuch tha hi nahi\"",
        "ek aise sawaal ka jawab hai jo usne poochha hi nahi, aur error screen ke saath.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Popular searches (guest ke liye chips)",
    event: [
      tests(200, [
        'pm.test("isEnabled aur queries", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d, "isEnabled").to.have.property("isEnabled");',
        '  pm.expect(d.queries, "queries").to.be.an("array");',
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/search/popular", ["search", "popular"]),
      auth: noAuth,
      description: [
        "**Access:** 🌐 public",
        "",
        "Search box khulte hi dikhne wali chips. **Admin curate karta hai**",
        "(`PUT /settings/update` → `customer.search.popularQueries`) — traffic se derive",
        "nahi hoti, kyunki customer kya search karta hai wo kahin log hi nahi hota, aur ye",
        "endpoint wo shuruaat jaan-boojh kar nahi kar raha.",
        "",
        "Mukhya audience guest hai: uski apni recent searches device par hain, to bina iske",
        "box khaali khulta.",
        "",
        "⚠️ `isEnabled: false` par bhi `200` aur `queries: []` — `404` nahi. Ek switch band",
        "karne se endpoint gayab hua nahi lagna chahiye.",
      ].join("\n"),
    },
    response: [],
  },
);

const FOLDER = {
  name: "00 — Search",
  description: [
    "Home screen ke upar wala global search box.",
    "",
    "Ek call, paanch sections — brands, offers, categories, sub-categories, areas. Poora",
    "module **token ke bina** chalta hai; sirf history wale endpoints ko login chahiye.",
    "",
    SECTION_TABLE,
    "",
    "Signed-in customer ko do cheezein extra milti hain aur kuch nahi badalta: coordinates",
    "na bhejne par uska saved address use ho jaata hai, aur `commit=true` wali query yaad",
    "rakhi jaati hai.",
    "",
    "Design ka poora *kyun* — [`docs/global_customer_search_plan.md`](../docs/global_customer_search_plan.md)",
  ].join("\n"),
  item: items,
};

// ---------------------------------------------------------------------------

const countExamples = (list) =>
  list.reduce(
    (sum, i) => sum + (i.item ? countExamples(i.item) : (i.response || []).length),
    0,
  );

const countRequests = (list) =>
  list.reduce((sum, i) => sum + (i.item ? countRequests(i.item) : 1), 0);

/** CRLF, exactly as these files are stored. */
const serialize = (obj) => `${JSON.stringify(obj, null, 2).replace(/\n/g, "\r\n")}\r\n`;

const readChecked = (relative) => {
  const full = path.join(DIR, relative);
  const raw = fs.readFileSync(full, "utf8");
  const parsed = JSON.parse(raw);
  if (serialize(parsed) !== raw) {
    console.error(
      `❌ ${relative}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
    );
    return null;
  }
  return { full, raw, parsed };
};

let changed = 0;

// ── collection ─────────────────────────────────────────────────────────────
const collectionFile = readChecked(COLLECTION);
if (!collectionFile) {
  process.exitCode = 1;
} else if (collectionFile.parsed.item.some((i) => /Search/.test(i.name))) {
  console.log(`⏭️  ${COLLECTION}: a Search folder is already present — nothing to do.`);
} else {
  const collection = collectionFile.parsed;
  const beforeExamples = countExamples(collection.item);
  const beforeRequests = countRequests(collection.item);

  /**
   * Inserted before the access-control folder, which is deliberately last, and
   * that folder is renumbered. The new folder **takes** its slot — numbering it
   * independently is how two folders ended up sharing a number last time.
   */
  const accessIndex = collection.item.findIndex((i) => /Access control/i.test(i.name));
  if (accessIndex === -1) {
    collection.item.push(FOLDER);
  } else {
    const access = collection.item[accessIndex];
    const slot = parseInt(access.name, 10);
    FOLDER.name = FOLDER.name.replace(/^\d+/, String(slot).padStart(2, "0"));
    access.name = access.name.replace(/^\d+/, String(slot + 1).padStart(2, "0"));
    collection.item.splice(accessIndex, 0, FOLDER);
  }

  const numbers = collection.item.map((i) => i.name.slice(0, 2));
  const duplicated = numbers.filter((n, idx) => numbers.indexOf(n) !== idx);
  const afterExamples = countExamples(collection.item);

  if (duplicated.length) {
    console.error(`❌ ${COLLECTION}: duplicate folder number(s) ${duplicated.join(", ")}.`);
    process.exitCode = 1;
  } else if (afterExamples !== beforeExamples) {
    console.error(
      `❌ ${COLLECTION}: captured examples changed ${beforeExamples} → ${afterExamples}. Refusing to write.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `${APPLY ? "✅" : "🔍"} ${COLLECTION}: +${FOLDER.item.length} requests ` +
        `as "${FOLDER.name}" (${beforeRequests} → ${countRequests(collection.item)}), ` +
        `examples unchanged at ${afterExamples}`,
    );
    if (APPLY) {
      fs.writeFileSync(collectionFile.full, serialize(collection), "utf8");
      changed += 1;
    }
  }
}

// ── environment ────────────────────────────────────────────────────────────
// The folder captures one id. A `{{variable}}` with no environment entry is
// exactly what `lib/validate-collection.js` refuses, so it goes in here rather
// than being left for whoever imports the collection to discover.
const NEW_VARS = [{ key: "search_history_id", value: "", type: "default", enabled: true }];

const envFile = readChecked(ENVIRONMENT);
if (!envFile) {
  process.exitCode = 1;
} else {
  const env = envFile.parsed;
  const missing = NEW_VARS.filter((v) => !env.values.some((e) => e.key === v.key));
  if (!missing.length) {
    console.log(`⏭️  ${ENVIRONMENT}: variables already present — nothing to do.`);
  } else {
    env.values.push(...missing);
    console.log(
      `${APPLY ? "✅" : "🔍"} ${ENVIRONMENT}: +${missing.length} variable(s) — ${missing
        .map((v) => v.key)
        .join(", ")}`,
    );
    if (APPLY) {
      fs.writeFileSync(envFile.full, serialize(env), "utf8");
      changed += 1;
    }
  }
}

console.log(
  APPLY
    ? changed + " file(s) updated. Validate with postman/lib/validate-collection.js"
    : "Dry run. Re-run with --apply to write.",
);
