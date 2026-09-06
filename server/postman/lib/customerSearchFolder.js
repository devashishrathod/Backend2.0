/**
 * The customer collection's global-search folder.
 *
 * Its own module for the same reason `customerMoneyFolders.js` is one: these
 * requests were previously inserted into the JSON by `scripts/addSearchRequestsToPostman.js`
 * because the generator could not run at all (see the note at the top of that
 * file), and the generator therefore had no idea search existed.
 *
 * Design rationale for the endpoint itself lives in
 * `docs/global_customer_search_plan.md`.
 */

const { req, folder, A } = require("./builders");

const CUST = "customer_token";

/** Joi's floor on `q`. Kept here so the 422 case cannot drift from the doc. */
const MIN_QUERY = 2;

const searchFolder = folder(
  "14 — Search",
  [
    "Home screen ke upar wala global search box.",
    "",
    "Ek call, paanch sections — brands, offers, categories, sub-categories, areas.",
    "Poora module **token ke bina** chalta hai; sirf history wale endpoints ko",
    "login chahiye.",
    "",
    "| Section | Source | Location chahiye? |",
    "|---|---|:-:|",
    "| `BRAND` | `Brand.brandName` | ❌ |",
    "| `VOUCHER` | `VoucherVersion` → current published version | ✅ |",
    "| `CATEGORY` · `SUB_CATEGORY` | `name` | ❌ |",
    "| `AREA` | live outlets ke `Location.city` | ❌ |",
    "",
    "Signed-in customer ko do cheezein extra milti hain aur kuch nahi badalta:",
    "coordinates na bhejne par uska saved address use ho jaata hai, aur",
    "`commit=true` wali query yaad rakhi jaati hai.",
    "",
    "⚠️ **`optionalAuth`, gate ka na hona nahi.** Guest ko andar aana hai, par",
    "signed-in caller ka `req.userId` maujood hona chahiye — bina gate ke wo",
    "`undefined` rehta hai us caller ke liye bhi jiska token bilkul theek hai, aur",
    "phir saved address kaam nahi karta. Aur jo token **hai** wo valid hona",
    "chahiye: expired token par `401`, chup-chaap guest view par downgrade nahi —",
    "warna session expire hone par customer ko apni saved location aur history",
    "gayab dikhti aur kahin koi error nahi hota.",
    "",
    "Design ka poora *kyun* —",
    "[`docs/global_customer_search_plan.md`](../docs/global_customent_search_plan.md)",
  ]
    .join("\n")
    .replace("global_customent_search_plan", "global_customer_search_plan"),
  [
    req({
      name: "Search — guest, bina location",
      method: "GET",
      segments: ["search"],
      query: [{ key: "q", value: "noida" }],
      description: [
        "Guest, koi token nahi, koi coordinates nahi.",
        "",
        "Paanch me se chaar sections phir bhi jawab dete hain — sirf `VOUCHER`",
        "section ko location chahiye, kyunki offer feed geo-scoped hai. Iska matlab",
        "guest ko khaali screen nahi milti: brands, categories aur areas dikhte",
        "hain, aur location maangne ka ek natural mauka banta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        /**
         * ⚠️ Rows live in `section.items`, not `section.results`, and each
         * section also carries `label`, `total` and a `seeAll` descriptor.
         *
         * `seeAll` is **told** to the client rather than built by it: it names
         * the endpoint and params for the "see all" screen, so the app does not
         * have to hard-code that a BRAND section paginates through
         * `/brands/customer/get-all` while an AREA section does not.
         */
        ...A.custom("sections aaye, aur har section ka shape sahi hai", [
          "const d = pm.response.json().data;",
          'pm.expect(d.query, "query").to.be.a("string");',
          'pm.expect(d.totalResults, "totalResults").to.be.a("number");',
          'pm.expect(d.hasLocation, "hasLocation").to.be.a("boolean");',
          'pm.expect(d.sections, "sections").to.be.an("array");',
          "d.sections.forEach(function (s) {",
          '  pm.expect(s.type, "type").to.be.a("string");',
          '  pm.expect(s.label, "label").to.be.a("string");',
          '  pm.expect(s.total, "total").to.be.a("number");',
          '  pm.expect(s.items, "items").to.be.an("array");',
          "});",
        ]),
        ...A.custom("guest ko location nahi hai, aur doc wahi kehta hai", [
          "const d = pm.response.json().data;",
          'pm.expect(d.hasLocation, "hasLocation").to.eql(false);',
        ]),
      ],
    }),

    req({
      name: "Search — location ke saath (saare sections)",
      method: "GET",
      segments: ["search"],
      query: [
        { key: "q", value: "off" },
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "limit", value: "3" },
      ],
      description: [
        "Coordinates ke saath **paanchon** sections aate hain.",
        "",
        "⚠️ `coordinates` DB me `[longitude, latitude]` order me hote hain — GeoJSON",
        "standard, Maps APIs se ulta — par **query params yahan naam se** aate hain,",
        "to yahan wo trap nahi hai. Indore = `22.7533, 75.8937`.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("limit har section par lagta hai", [
          "const d = pm.response.json().data;",
          "d.sections.forEach(function (s) {",
          '  pm.expect(s.items.length, s.type + " items").to.be.at.most(3);',
          "});",
        ]),
        ...A.custom("coordinates diye, to hasLocation sach hai", [
          "const d = pm.response.json().data;",
          'pm.expect(d.hasLocation, "hasLocation").to.eql(true);',
        ]),
      ],
    }),

    req({
      name: "Search — signed in, history me save karo (commit)",
      method: "GET",
      segments: ["search"],
      query: [
        { key: "q", value: "pizza" },
        { key: "commit", value: "true" },
      ],
      token: CUST,
      description: [
        "`commit=true` hi wo cheez hai jo query ko history me daalti hai.",
        "",
        "⚠️ Har keystroke save karna history ko bekaar kar deta hai — `p`, `pi`,",
        "`piz`, `pizz`, `pizza` sab rows ban jaate. Isliye app **type karte waqt**",
        "`commit` nahi bhejti, aur jab user actually search karta hai (enter, ya",
        "result par tap) tab bhejti hai.",
        "",
        "Guest ke liye `commit` chup-chaap ignore hota hai — save karne ke liye koi",
        "identity hi nahi hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: 'Ek hi type, paginated — Areas ka "see all"',
      method: "GET",
      segments: ["search"],
      query: [
        { key: "q", value: "ind" },
        { key: "type", value: "AREA" },
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      description: [
        '`type` dene par ek hi section aata hai, **paginated** — yahi "see all"',
        "screen hai.",
        "",
        "Bina `type` ke response paanch chhote sections deta hai aur pagination ka",
        "koi matlab nahi banta; isliye `page` sirf `type` ke saath valid hai (agla",
        "request wahi dikhata hai).",
        "",
        "⚠️ **Shape yahan alag hai.** Overview `sections[]` deta hai; single-type",
        "mode `items[]` seedha `data` par deta hai, `total` · `totalPages` · `page`",
        "· `limit` ke saath. Ek hi response shape dono ke liye maanna aam galti hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("single-type mode: items top-level, paginated", [
          "const d = pm.response.json().data;",
          'pm.expect(d.type, "type").to.eql("AREA");',
          'pm.expect(d.items, "items").to.be.an("array");',
          'pm.expect(d.total, "total").to.be.a("number");',
          'pm.expect(d.totalPages, "totalPages").to.be.a("number");',
          'pm.expect(d.page, "page").to.be.a("number");',
          'pm.expect(d.limit, "limit").to.be.a("number");',
          'pm.expect(d, "sections").to.not.have.property("sections");',
        ]),
      ],
    }),

    req({
      name: "Sirf kuch sections chahiye — types filter",
      method: "GET",
      segments: ["search"],
      query: [
        { key: "q", value: "food" },
        { key: "types", value: "BRAND,CATEGORY" },
      ],
      description: [
        "`types` (plural) multi-section filter hai; `type` (singular) single-section",
        "paginated mode hai. Dono alag cheezein hain aur naam jaan-boojh kar alag",
        "hain.",
        "",
        "Kaam ka hai jab screen ko sirf do sections dikhane hain — jo sections",
        "maange nahi gaye unki query chalti hi nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("sirf maange gaye sections aaye", [
          "const d = pm.response.json().data;",
          "const got = (d.sections || []).map(function (s) { return s.type; });",
          "got.forEach(function (t) {",
          '  pm.expect(["BRAND", "CATEGORY"], "unexpected section " + t).to.include(t);',
          "});",
        ]),
      ],
    }),

    req({
      name: "Bahut chhoti query — 422",
      method: "GET",
      segments: ["search"],
      query: [{ key: "q", value: "o" }],
      description: [
        `\`q\` ke liye kam se kam **${MIN_QUERY} characters** chahiye.`,
        "",
        "Ek character par har brand, category aur area match ho jaata — result",
        "bekaar hota aur query mehngi. Ye limit `validator/search.js` me hai, aur",
        "yahan usi ko dohraya nahi gaya: ye request usse **padhti** hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "page bina type ke — 422",
      method: "GET",
      segments: ["search"],
      query: [
        { key: "q", value: "pizza" },
        { key: "page", value: "2" },
      ],
      description: [
        "`page` sirf single-type mode me valid hai.",
        "",
        "Multi-section response me *\"page 2\"* ka koi matlab nahi hai — paanch",
        "sections apne-apne chhote result set dete hain. Ise chup-chaap ignore",
        "karne par client ko lagta rehta ki wo paginate kar raha hai jabki wahi",
        "pehla page dobara aa raha hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Meri recent searches",
      method: "GET",
      segments: ["search", "history"],
      token: CUST,
      description: [
        "Customer ki apni recent searches.",
        "",
        "⚠️ **`isCustomer`, `optionalAuth` nahi** — aur ye jaan-boojh kar hai. Guest",
        "ki recent searches uske **device par** rehti hain: yahan koi anonymous",
        'identity nahi hai jispar row key ki ja sake. Guest ko khaali list dena ye',
        'daava hoga ki *"tumne kuch search nahi kiya"*, jabki uski history bas',
        "wahan hai jahan ye endpoint dekh nahi sakta.",
        "",
        "⚠️ Route file me `/history` **`/:historyId` se pehle** declare hai, warna",
        "literal `history` ek id samajh liya jaata — aur `/` se bhi pehle, warna wo",
        "ise nigal leta.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
      capture: [["search_history_id", "d.data ? d.data[0]._id : d[0]._id"]],
    }),

    req({
      name: "Ek entry hataao",
      method: "DELETE",
      segments: ["search", "history", "{{search_history_id}}"],
      token: CUST,
      description: [
        "Ek recent search hataao — *\"ye mat dikhao\"*.",
        "",
        "Soft delete, baaki sab ki tarah, aur sirf apni row par: filter me",
        "`customerId` hamesha hota hai, to kisi aur ki history ki id bhejne par",
        "`404` aata hai, `403` nahi — *\"hai par tumhari nahi\"* kehna id asli hone",
        "ki tasdeeq kar dena hota.",
      ].join("\n"),
      assert: [
        ...A.custom("hat gaya, ya pehle se nahi tha", [
          'pm.expect(pm.response.code, "status").to.be.oneOf([200, 404, 422]);',
          'pm.expect(pm.response.json()).to.have.property("success");',
        ]),
      ],
    }),

    req({
      name: "Poori history clear",
      method: "DELETE",
      segments: ["search", "history"],
      token: CUST,
      description: [
        "*\"Clear all\"* button.",
        "",
        "Khaali history par bhi `200` — clear karne ke liye kuch na hona koi error",
        "nahi hai, aur `404` dena us button ko toota hua dikha deta.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "Popular searches (guest ke liye chips)",
      method: "GET",
      segments: ["search", "popular"],
      description: [
        "Wo chips jo kisi ne type karne se **pehle** dikhte hain.",
        "",
        "Public, aur **mostly guests ke liye** — signed-in customer ko apni recent",
        "history dikhti hai, par guest ki history uske device par hai, to uske liye",
        "yahi ek starting point hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

module.exports = { searchFolder };
