/**
 * Rebuild the home-screen banner set from scratch.
 *
 * ⚠️ This is the one seeder that **hard deletes**. Every other cleanup in this
 * repo is a soft delete, because domain data is never physically removed — but
 * the banners in the development database are throwaway test rows with expired
 * campaign dates and titles like "this Testing banne", and keeping them soft
 * deleted would leave them in `GET /banners/get-all` for ever with no way for
 * an admin to tell them from the real set. They also hold Cloudinary assets
 * that cost storage and that nothing will ever reference again, so the assets
 * go with the rows.
 *
 * ### What it builds
 *
 *   8 scheduled  start and end scattered across 11-20 Sep 2026, so banners
 *                come and go day by day
 *  10 evergreen  no dates at all
 *
 * The two pools are what `GET /banners/customer/active` reads: scheduled
 * banners take the slots first, evergreen ones fill whatever is left, and the
 * list is cut at BANNER_ACTIVE_LIMIT. With this data the home screen carries
 * ten banners every single day, and the mix shifts as the schedules expire —
 * which is the behaviour that is worth having real data for, because a single
 * evergreen row proves none of it.
 *
 * ### The images are real, and they are made here
 *
 * Category-matched photographs, uploaded to our own Cloudinary straight from
 * their source URL, with the offer text baked in by an **incoming**
 * transformation — so the stored asset *is* the banner, rather than a photo
 * that only looks like one when a delivery URL adds text to it.
 *
 * GIFs are genuinely animated: three text-baked frames are uploaded, joined by
 * `uploader.multi`, and then the result is **re-uploaded as a normal asset**.
 * That last step is not cosmetic. `multi` serves from `/image/multi/`, and
 * `helpers/cloudinary/deleteFile` only recognises `/upload/` — a banner left on
 * a multi URL could never have its asset deleted by the app, and the failure
 * would be a silent "Skip delete", not an error. The frames are removed once
 * the GIF exists.
 *
 * Dry run by default, like every script here:
 *
 *   node scripts/seedHomeBanners.js            # what it would do
 *   node scripts/seedHomeBanners.js --apply    # do it
 */
require("dotenv").config({ quiet: true });
const dns = require("dns");
const mongoose = require("mongoose");

const cloudinary = require("../configs/cloudinary");
const {
  BANNER_TYPE,
  BANNER_REDIRECT_TYPE,
  BANNER_ACTIVE_LIMIT,
} = require("../constants/banner");

// Atlas SRV lookup fails on some networks' default resolver, and a failed first
// attempt leaves mongoose buffering rather than retrying.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------- the plan
//
// Dates are IST day boundaries, not UTC: an admin scheduling "11 to 13
// September" means the Indian calendar days, and a UTC midnight would start the
// banner at 05:30 IST and end it 5.5 hours early.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDayStart = (day) =>
  new Date(Date.UTC(2026, 8, day, 0, 0, 0, 0) - IST_OFFSET_MS);
const istDayEnd = (day) =>
  new Date(Date.UTC(2026, 8, day, 23, 59, 59, 999) - IST_OFFSET_MS);

const CATEGORY = {
  beverages: "Alternative Beverage & Desserts",
  transport: "Transportation",
  spa: "spa",
  hotels: "Luxury Hotels",
  beauty: "Cosmetics & Beauty",
  wedding: "Bride & Groom's Wear",
  photographers: "Photographers",
  accessories: "Accessories",
  food: "food & dining",
};

const photo = (id) =>
  `https://images.unsplash.com/${id}?w=1600&h=800&fit=crop&q=80`;

/**
 * ⚠️ Text is deliberately plain ASCII. Cloudinary's structured overlay encodes
 * the string into the delivery URL, and a `%` or a `/` in it produces a 400 at
 * upload time rather than a wrong-looking banner — which is the sort of failure
 * that would show up on only two of eighteen rows.
 */
const SCHEDULED = [
  {
    title: "Beauty Week - Flat 50% Off",
    description: "Salon and cosmetics vouchers at partner outlets.",
    type: BANNER_TYPE.IMAGE,
    headline: "FLAT 50% OFF",
    caption: "Beauty Week - salons and cosmetics",
    source: photo("photo-1596462502278-27bfdc403348"),
    category: CATEGORY.beauty,
    startDay: 11,
    endDay: 13,
  },
  {
    title: "Weekend Feast - Up to 40% Off",
    description: "Dine-in vouchers at partner restaurants.",
    type: BANNER_TYPE.IMAGE,
    headline: "WEEKEND FEAST",
    caption: "Up to 40% off at partner restaurants",
    source: photo("photo-1517248135467-4c7edcad34c4"),
    category: CATEGORY.food,
    startDay: 11,
    endDay: 15,
  },
  {
    title: "Spa Retreat - 35% Off",
    description: "Spa and wellness sessions, booked through Trydood.",
    type: BANNER_TYPE.IMAGE,
    headline: "SPA RETREAT",
    caption: "Save 35% on wellness sessions",
    source: photo("photo-1544161515-4ab6ce6db874"),
    category: CATEGORY.spa,
    startDay: 12,
    endDay: 16,
  },
  {
    title: "Flash Deal - Ends Tonight",
    description: "Animated banner for the running flash sale.",
    type: BANNER_TYPE.GIF,
    headline: "FLASH DEAL",
    caption: "Up to 60% off - ends tonight",
    frames: [
      photo("photo-1513104890138-7c749659a591"),
      photo("photo-1568901346375-23c9450c58cd"),
      photo("photo-1554118811-1e0d58224f24"),
    ],
    category: null,
    startDay: 13,
    endDay: 17,
  },
  {
    title: "Stay and Save - Luxury Hotels",
    description: "Hotel stays at 30% off for the festive week.",
    type: BANNER_TYPE.IMAGE,
    headline: "STAY AND SAVE",
    caption: "Luxury hotels from 30% off",
    source: photo("photo-1566073771259-6a8506099945"),
    category: CATEGORY.hotels,
    startDay: 14,
    endDay: 18,
  },
  {
    title: "Dessert Days - 45% Off",
    description: "Desserts and beverages across partner cafes.",
    type: BANNER_TYPE.IMAGE,
    headline: "DESSERT DAYS",
    caption: "Sweet deals up to 45% off",
    source: photo("photo-1551024506-0bccd828d307"),
    category: CATEGORY.beverages,
    startDay: 15,
    endDay: 19,
  },
  {
    title: "Ride for Less - 25% Off",
    description: "City rides at a flat discount.",
    type: BANNER_TYPE.IMAGE,
    headline: "RIDE FOR LESS",
    caption: "Flat 25% off on city rides",
    source: photo("photo-1449965408869-eaa3f722e40d"),
    category: CATEGORY.transport,
    startDay: 16,
    endDay: 20,
  },
  {
    title: "Bridal Week - 40% Off",
    description: "Animated banner for bridal and groom wear.",
    type: BANNER_TYPE.GIF,
    headline: "BRIDAL WEEK",
    caption: "Bride and groom wear at 40% off",
    frames: [
      photo("photo-1445205170230-053b83016050"),
      photo("photo-1483985988355-763728e1935b"),
      photo("photo-1560066984-138dadb4c035"),
    ],
    category: CATEGORY.wedding,
    startDay: 18,
    endDay: 20,
  },
];

const EVERGREEN = [
  {
    title: "Every Day Savings",
    description: "The always-on brand banner.",
    type: BANNER_TYPE.IMAGE,
    headline: "EVERY DAY SAVINGS",
    caption: "Trydood vouchers at partner outlets",
    source: photo("photo-1483985988355-763728e1935b"),
    category: null,
  },
  {
    title: "Cafe Favourites",
    description: "Coffee and cafe vouchers near you.",
    type: BANNER_TYPE.IMAGE,
    headline: "CAFE FAVOURITES",
    caption: "Coffee and more, near you",
    source: photo("photo-1554118811-1e0d58224f24"),
    category: CATEGORY.food,
  },
  {
    title: "Glow Every Day",
    description: "Salon and nail bar vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "GLOW EVERY DAY",
    caption: "Salons and nail bars near you",
    source: photo("photo-1604654894610-df63bc536371"),
    category: CATEGORY.beauty,
  },
  {
    title: "Sweet Cravings",
    description: "Bakery and sweet shop vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "SWEET CRAVINGS",
    caption: "Bakeries and sweet shops nearby",
    source: photo("photo-1486427944299-d1955d23e34d"),
    category: CATEGORY.beverages,
  },
  {
    title: "Cool Down",
    description: "Ice cream and shake vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "COOL DOWN",
    caption: "Ice cream and shakes all summer",
    source: photo("photo-1497034825429-c343d7c6a68f"),
    category: CATEGORY.beverages,
  },
  {
    title: "Fresh and Healthy",
    description: "Juice bar vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "FRESH AND HEALTHY",
    caption: "Juice bars around you",
    source: photo("photo-1622597467836-f3285f2131b8"),
    category: CATEGORY.food,
  },
  {
    title: "Pamper Yourself",
    description: "Massage and therapy vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "PAMPER YOURSELF",
    caption: "Massage and spa therapies",
    source: photo("photo-1600334089648-b0d9d3028eb2"),
    category: CATEGORY.spa,
  },
  {
    title: "Weekend Getaway",
    description: "Resort and stay vouchers.",
    type: BANNER_TYPE.IMAGE,
    headline: "WEEKEND GETAWAY",
    caption: "Resorts and stays worth the drive",
    source: photo("photo-1571003123894-1f0594d2b5d9"),
    category: CATEGORY.hotels,
  },
  // ⚠️ Every frame has to belong to the category the banner redirects into.
  // These two first shipped with whatever photograph was to hand — a gym and a
  // resort under "Book a Shoot", electronics and cake under an Accessories
  // link. Nothing rejects that: the banner renders, the tap lands on the right
  // screen, and only a person looking at it can tell the picture is wrong.
  {
    title: "Trending Now",
    description: "Animated evergreen banner for accessories.",
    type: BANNER_TYPE.GIF,
    headline: "TRENDING NOW",
    caption: "Watches, bags and more",
    frames: [
      photo("photo-1524805444758-089113d48a6d"),
      photo("photo-1584917865442-de89df76afd3"),
      photo("photo-1511499767150-a48a237f0083"),
    ],
    category: CATEGORY.accessories,
  },
  {
    title: "Book a Shoot",
    description: "Animated evergreen banner for photographers.",
    type: BANNER_TYPE.GIF,
    headline: "BOOK A SHOOT",
    caption: "Photographers for every occasion",
    frames: [
      photo("photo-1516035069371-29a1b244cc32"),
      photo("photo-1502920917128-1aa500764cbd"),
      photo("photo-1519741497674-611481863552"),
    ],
    category: CATEGORY.photographers,
  },
];

// ---------------------------------------------------------------- uploading

/**
 * The banner creative, as an incoming transformation.
 *
 * ⚠️ Each line of text sits on its own **translucent black band**, and that is
 * load bearing rather than decorative. White text laid straight onto a
 * photograph is unreadable wherever the photograph is pale, and the darkening
 * pass alone does not save it: measured on the ice-cream and cupcake shots —
 * bright yellow and pale blue — the headline all but disappeared while the same
 * recipe looked fine on the other sixteen. That is the worst kind of defect to
 * leave in a fixture, because it is invisible until somebody opens the app and
 * then it looks like a bug in the app.
 *
 * The band is generated by Cloudinary's own text layer (`background`), so there
 * is no extra asset to keep. Padding comes from spaces around the string —
 * a text layer has no padding parameter, and this is the documented way round it.
 */
const band = (text, size, color, width, y) => ({
  overlay: {
    font_family: "Arial",
    font_size: size,
    ...(color === "#FFFFFF" ? { font_weight: "bold" } : {}),
    text: `  ${text}  `,
  },
  color,
  background: "#000000A6",
  gravity: "south_west",
  x: Math.round(width / 27),
  y,
});

const creative = (headline, caption, width, height) => [
  { width, height, crop: "fill", gravity: "auto" },
  { effect: "brightness:-30" },
  band(headline, Math.round(width / 17), "#FFFFFF", width, Math.round(height / 4.2)),
  band(caption, Math.round(width / 30), "#FFD84D", width, Math.round(height / 6.8)),
];

const uploadStill = async (spec, slug) => {
  const result = await cloudinary.uploader.upload(spec.source, {
    public_id: `Banners/${slug}`,
    resource_type: "image",
    format: "jpg",
    overwrite: true,
    transformation: creative(spec.headline, spec.caption, 1600, 800),
  });
  return {
    url: result.secure_url,
    storage: {
      provider: "CLOUDINARY",
      publicId: result.public_id,
      bucket: null,
      key: null,
    },
    bytes: result.bytes,
    dimensions: `${result.width}x${result.height}`,
    frames: 1,
  };
};

const uploadAnimated = async (spec, slug) => {
  const tag = `banner_frames_${slug.replace(/[^a-z0-9]/gi, "_")}`;
  const framePublicIds = [];

  for (let i = 0; i < spec.frames.length; i += 1) {
    // ⚠️ The index belongs in the public_id: `multi` stacks frames in public_id
    // order, so without it the animation plays in whatever order Cloudinary
    // returns the tagged assets.
    const frame = await cloudinary.uploader.upload(spec.frames[i], {
      public_id: `Banners/_frames/${slug}_${i}`,
      resource_type: "image",
      format: "jpg",
      overwrite: true,
      tags: [tag],
      transformation: creative(spec.headline, spec.caption, 1000, 500),
    });
    framePublicIds.push(frame.public_id);
  }

  const stitched = await cloudinary.uploader.multi(tag, {
    format: "gif",
    delay: 1100,
  });

  // Re-upload so the asset lives under /upload/ like every other one — see the
  // header note. Deliberately no transformation here: a transform on an
  // animated GIF without `fl_animated` silently flattens it to frame one.
  const result = await cloudinary.uploader.upload(stitched.secure_url, {
    public_id: `Banners/${slug}`,
    resource_type: "image",
    format: "gif",
    overwrite: true,
  });

  for (const id of framePublicIds) {
    await cloudinary.uploader.destroy(id, { resource_type: "image" });
  }

  return {
    url: result.secure_url,
    storage: {
      provider: "CLOUDINARY",
      publicId: result.public_id,
      bucket: null,
      key: null,
    },
    bytes: result.bytes,
    dimensions: `${result.width}x${result.height}`,
    frames: result.pages || spec.frames.length,
  };
};

// ---------------------------------------------------------------- simulation

/**
 * What `GET /banners/customer/active` will answer on a given day.
 *
 * A copy of the service's two queries rather than a call to it, because the
 * service reads `new Date()` and the whole point here is to look at other days.
 * Keep the two in step: if the selection changes, this has to change with it.
 */
const simulate = async (Banner, at) => {
  const base = { isActive: true, isDeleted: false };
  const scheduled = await Banner.find({
    ...base,
    startDate: { $ne: null, $lte: at },
    endDate: { $ne: null, $gte: at },
  })
    .sort({ startDate: -1 })
    .limit(BANNER_ACTIVE_LIMIT)
    .select("title")
    .lean();

  if (scheduled.length >= BANNER_ACTIVE_LIMIT) return { scheduled, fallback: [] };

  const fallback = await Banner.find({ ...base, startDate: null, endDate: null })
    .sort({ createdAt: -1 })
    .limit(BANNER_ACTIVE_LIMIT - scheduled.length)
    .select("title")
    .lean();

  return { scheduled, fallback };
};

// ---------------------------------------------------------------- main

const line = (char = "─") => console.log(char.repeat(72));

(async () => {
  await mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 15000,
  });

  const Banner = require("../models/Banner");
  const User = require("../models/User");
  const Category = require("../models/Category");
  const { assertActiveBannerCapacity } = require("../helpers/banners");
  const {
    getActiveBannersForCustomer,
  } = require("../services/banners/getActiveBannersForCustomer");

  console.log(`\n  database: ${mongoose.connection.name}`);
  console.log(`  cloudinary: ${cloudinary.config().cloud_name}`);
  if (!APPLY) {
    console.log("\n── DRY RUN ── nothing is deleted, uploaded or written.");
    console.log("   Re-run with --apply to do it for real.");
  }

  const admin = await User.findOne({ role: "ADMIN" }).select("_id name").lean();
  if (!admin) throw new Error("No ADMIN user in this database to own the banners.");
  console.log(`  createdBy: ${admin._id} (${admin.name || "admin"})`);

  const categories = await Category.find({ isDeleted: false })
    .select("_id name")
    .lean();
  const categoryId = (name) => {
    if (!name) return null;
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`Category not found: ${name}`);
    return found._id;
  };
  // Resolved up front: a missing category should stop the run before anything
  // is deleted, not half way through the uploads.
  for (const spec of [...SCHEDULED, ...EVERGREEN]) categoryId(spec.category);

  // ---- 1. remove what is there ---------------------------------------------
  line("═");
  console.log("  1. existing banners");
  line();
  const existing = await Banner.find({}).lean();
  console.log(`  ${existing.length} documents\n`);

  const assets = [];
  for (const row of existing) {
    const media = row.image || row.video || row.gif || {};
    const publicId = media.storage?.publicId || null;
    const kind = String(row.type || "").toUpperCase() === BANNER_TYPE.VIDEO
      ? "video"
      : "image";
    console.log(
      `   ${String(row._id)}  ${String(row.type).padEnd(5)}  ${JSON.stringify(row.title)}`,
    );
    console.log(`      cloudinary: ${publicId || "(none recorded)"}  [${kind}]`);
    if (publicId) assets.push({ publicId, kind });
  }

  if (APPLY) {
    let removed = 0;
    for (const { publicId, kind } of assets) {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: kind,
      });
      console.log(`   cloudinary destroy ${publicId} -> ${result.result}`);
      if (result.result === "ok") removed += 1;
    }
    const { deletedCount } = await Banner.deleteMany({});
    console.log(`\n   hard deleted ${deletedCount} documents · ${removed}/${assets.length} assets removed`);
  } else {
    console.log(`\n   would hard delete ${existing.length} documents and ${assets.length} cloudinary assets`);
  }

  // ---- 2. build the new set -------------------------------------------------
  line("═");
  console.log("  2. new banners");
  line();

  const plan = [
    ...SCHEDULED.map((spec, i) => ({
      ...spec,
      slug: `scheduled_${String(i + 1).padStart(2, "0")}`,
      startDate: istDayStart(spec.startDay),
      endDate: istDayEnd(spec.endDay),
    })),
    ...EVERGREEN.map((spec, i) => ({
      ...spec,
      slug: `evergreen_${String(i + 1).padStart(2, "0")}`,
      startDate: null,
      endDate: null,
    })),
  ];

  // ⚠️ Printed in IST, because that is the calendar the dates were written
  // against. Formatting the raw instant shows 11 Sep 00:00 IST as "2026-09-10",
  // which reads as an off-by-one bug in data that is perfectly correct.
  const day = (d) =>
    d
      ? new Date(new Date(d).getTime() + IST_OFFSET_MS)
          .toISOString()
          .slice(0, 10)
      : "—";

  for (const spec of plan) {
    const window = spec.startDate
      ? `${day(spec.startDate)} → ${day(spec.endDate)} IST`
      : "evergreen";
    console.log(`   ${spec.slug}  ${spec.type.padEnd(5)}  ${window.padEnd(25)} ${spec.title}`);

    if (!APPLY) continue;

    // The same guard the admin API runs, on the same data — so the seed cannot
    // create a set the API itself would have refused.
    await assertActiveBannerCapacity({
      isActive: true,
      startDate: spec.startDate,
      endDate: spec.endDate,
    });

    const media =
      spec.type === BANNER_TYPE.GIF
        ? await uploadAnimated(spec, spec.slug)
        : await uploadStill(spec, spec.slug);

    const field = spec.type === BANNER_TYPE.GIF ? "gif" : "image";
    const target = categoryId(spec.category);

    await Banner.create({
      title: spec.title,
      description: spec.description,
      type: spec.type,
      [field]: { url: media.url, storage: media.storage },
      redirect: target
        ? { type: BANNER_REDIRECT_TYPE.CATEGORY, targetId: target, url: null }
        : { type: BANNER_REDIRECT_TYPE.NONE, targetId: null, url: null },
      startDate: spec.startDate,
      endDate: spec.endDate,
      isActive: true,
      createdBy: admin._id,
    });

    console.log(
      `      ${media.dimensions} · ${media.frames} frame(s) · ${Math.round(media.bytes / 1024)} KB · ${media.url}`,
    );
  }

  if (!APPLY) {
    console.log(`\n   would upload ${plan.length} assets and create ${plan.length} banners`);
    await mongoose.disconnect();
    return;
  }

  // ---- 3. what the app will answer ------------------------------------------
  line("═");
  console.log("  3. GET /banners/customer/active — the real service, today");
  line();
  const live = await getActiveBannersForCustomer();
  console.log(`  ${live.length} banners\n`);
  const titles = await Banner.find({ _id: { $in: live.map((b) => b._id) } })
    .select("title startDate")
    .lean();
  live.forEach((banner, i) => {
    const row = titles.find((t) => String(t._id) === String(banner._id));
    console.log(
      `   ${String(i + 1).padStart(2)}. ${banner.type.padEnd(5)} ${(row?.startDate ? "scheduled" : "evergreen").padEnd(10)} ${row?.title}`,
    );
  });

  line("═");
  console.log("  4. day by day — scheduled shrink, evergreen fill from the back");
  line();
  for (const d of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 25]) {
    const noon = new Date(Date.UTC(2026, 8, d, 12, 0, 0) - IST_OFFSET_MS);
    const { scheduled, fallback } = await simulate(Banner, noon);
    console.log(
      `   ${day(noon)}   scheduled ${String(scheduled.length).padStart(2)}  +  evergreen ${String(fallback.length).padStart(2)}  =  ${scheduled.length + fallback.length}`,
    );
  }

  line("═");
  const counts = {
    total: await Banner.countDocuments({}),
    scheduled: await Banner.countDocuments({ startDate: { $ne: null } }),
    evergreen: await Banner.countDocuments({ startDate: null }),
    image: await Banner.countDocuments({ type: BANNER_TYPE.IMAGE }),
    gif: await Banner.countDocuments({ type: BANNER_TYPE.GIF }),
    video: await Banner.countDocuments({ type: BANNER_TYPE.VIDEO }),
  };
  console.log(`  done — ${JSON.stringify(counts)}`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("\n❌", error.message || error);
  if (error.error) console.error("   detail:", JSON.stringify(error.error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
