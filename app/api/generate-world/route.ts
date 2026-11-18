import { NextResponse } from "next/server";

const BASE_MATERIAL_PROMPTS: Record<string, string> = {
  cloud: "CLOUD is the complete visible body: one continuous sculptural mass of dense pearlescent cloud volume with bright white cores, pale blue-grey depth, soft billowing lobes and vapor-soft edges. It must replace every visible part of the clay armature, not appear as separate cotton puffs.",
  metal: "METAL FRAGMENTS are the complete visible body: interlocking folded liquid-silver and brushed-metal plates with mirror faces, dark seams, blade-like rims and believable thickness. The plates must cover every visible part of the clay armature as one coherent metal sculpture.",
  sand: "SAND is the complete visible body: the entire silhouette is built from compacted champagne-to-amber sand with wind-carved ridges, dune crests, granular fractures and a few falling grains. No smooth clay skin may remain visible.",
  stone: "STONE is the complete visible body: the whole artifact is carved from connected charcoal and warm-grey rock with chipped planes, pale mineral veins, fractures and deep creases. It must read as one stone sculpture, not scattered pebbles attached to clay.",
  light: "BUBBLE is the complete visible body: the entire silhouette is formed from connected transparent iridescent soap-bubble membranes and fused rounded chambers, with rainbow film, crisp hot highlights and lavender-cyan refraction. No opaque white armature may show through as an exterior surface.",
  ice: "ICE is the complete visible body: the whole silhouette is solid glacier-blue ice with transparent depth, frosted cracks, trapped bubbles, razor edges and icicles. Ice replaces the clay exterior completely rather than growing on only one side.",
  chrome: "GLASS is the complete visible body: the entire silhouette is made from thick clear sculptural glass with pale aqua edges, realistic refraction, trapped air, curved lenses and crisp highlights. No opaque clay exterior may remain visible.",
  moss: "MOSS is the complete visible body: dense living forest moss covers and composes the entire silhouette, combining deep green cushions, shaggy chartreuse tufts and tiny branching fibers. The hidden clay serves only as an armature and must not be visible.",
  wood: "SOIL is the complete visible body: the entire silhouette is built from connected rich umber earth, coarse soil clods, exposed ochre strata, dry cracks, roots and granular edges. It must read as a coherent earthen sculpture with no white clay showing.",
  cocoon: "SALT is the complete visible body: the whole artifact is formed from milky salt, from compact powdery chalk deposits to translucent cubic crystals and sparkling mineral facets. Salt must replace every visible clay surface rather than appearing as a few reefs.",
  water: "WATER DROPLET is the complete visible body: the entire silhouette is a coherent mass of clear water with a subtle cyan cast, rounded liquid tension, glassy sheets, refraction, suspended bubbles, caustic highlights and controlled droplets. The white armature must be completely hidden.",
};

const ATTACHMENT_PROMPTS: Record<string, string> = {
  flower: "FLOWERS bloom outward from the body on distinct slender green stems: fully open wildflowers in coral, butter yellow, blush pink and occasional cobalt, at varied heights with air and cast shadows beneath petals. They are real three-dimensional blooms, never prints, embossing or buried petals.",
  leaf: "LEAVES grow and wrap directionally around the body on visible petioles: emerald, olive and yellow-green spear leaves, round young leaves and curled tips with readable veins, overlapping in free space rather than becoming a flat green coating.",
  branch: "BRANCHES project outward from two or three anchor points as sparse antler-like warm-brown forks with knots, snapped tips and fibrous bark. They remain branches attached to the body, never a bark texture painted over it.",
  mushroom: "MUSHROOMS sprout from the body in a damp forest colony: ivory oyster shelves, ochre rounded caps and a few tall rust-red caps on complete visible stems, with readable gills and strong differences in height and size.",
  fruit: "FRUIT hangs naturally from short stems around the body: recognizable ripe tangerine, scarlet and golden fruit with a few supporting leaves, varied sizes, porous peel, gravity and contact shadows. Use whole hanging fruit, never embedded slices or pulp textures.",
  fabric: "FABRIC drapes around the body as one broad translucent ivory-to-lilac organza veil with long floating hems, deep soft folds and visible tension points. It remains cloth with air beneath it, never small scraps or a surface texture.",
  crystal: "CRYSTALS erupt from the exterior in a concentrated amethyst geode cluster: needle-sharp violet points graduating from tiny lilac shards to tall dark-purple spikes with internal fractures and prismatic edges. The points must visibly protrude from the body.",
  feather: "FEATHERS spread in a windswept layered fan around the body: long ivory, smoke-grey and one black-tipped feather with curved shafts and fine separated barbs, lifted away from the surface rather than printed flat.",
  ribbon: "RIBBON wraps around the body as one continuous saturated vermilion-and-blush satin strip in generous front-to-back loops, with a crossing and long free tails. Keep visible thickness, air gaps and cast shadows; never turn it into a painted stripe or fused vein.",
  lily: "LILY-OF-THE-VALLEY grows outward as an elegant grove on long arching emerald stems, with complete porcelain-white hanging bells, pale green buds and broad fresh leaves. It must sprout in free space rather than appear printed or recessed.",
  rose: "ROSES bloom outward in a theatrical cascade of crimson, burgundy and one pale-pink flower on visible thorned stems and green calyxes. Include buds and large layered blooms in varied orientations; never press or carve them into the surface.",
};

const MATERIAL_PROMPTS: Record<string, string> = { ...BASE_MATERIAL_PROMPTS, ...ATTACHMENT_PROMPTS };
const BASE_MATERIAL_IDS = new Set(Object.keys(BASE_MATERIAL_PROMPTS));

const MATERIAL_FINISH_PROMPTS: Record<string, string> = {
  cloud: "Finish CLOUD with deep soft volume, chalk-white cores, blue-grey self-shadow, velvety high roughness and translucent vapor edges; never make it flat white plastic or cotton balls.",
  metal: "Finish METAL with true mirror and brushed reflections, sharp dark seams, anisotropic highlights, high metalness and low roughness; never paint it flat grey.",
  sand: "Finish SAND with individually readable champagne grains, porous micro-shadow, dry granular roughness and small crumbling edges; never smooth it into beige clay.",
  stone: "Finish STONE with matte mineral grain, chipped planes, pores, veins and varied charcoal-to-warm-grey reflectance; never make it smooth cement.",
  light: "Finish BUBBLE as thin transparent soap film with strong transmission, rainbow iridescence, crisp rim highlights and clear overlapping chambers; never make it opaque pearl plastic.",
  ice: "Finish ICE with transparent blue depth, frosted fractures, trapped bubbles, sharp wet highlights and visible refraction; never make it solid pale-blue resin.",
  chrome: "Finish GLASS with clear optical transmission, realistic lens distortion, thick pale-aqua edges, internal reflections and bright caustic highlights; never make it cloudy white acrylic.",
  moss: "Finish MOSS with dense fuzzy fibers, velvety micro-shadow and many distinct damp green tones; never make it a flat green texture.",
  wood: "Finish SOIL with dry rough clods, loose grains, dark moist creases, ochre strata and fine root fibers; never make it a smooth brown coating.",
  cocoon: "Finish SALT with powdery matte deposits mixed with translucent cubic crystals, sparkling mineral facets and milky subsurface depth; never make it plain white plaster.",
  water: "Finish WATER with near-clear transmission, cyan edge tint, liquid refraction, caustic highlights, suspended bubbles and high-gloss surface tension; never make it opaque blue plastic.",
  flower: "Finish FLOWERS with delicate translucent petal edges, velvety color variation, pollen texture and moist green stems.",
  leaf: "Finish LEAVES with waxy living surfaces, clear veins, slightly translucent edges and varied fresh greens.",
  branch: "Finish BRANCHES with fibrous cracked bark, dry matte ridges, dark knots and freshly snapped pale tips.",
  mushroom: "Finish MUSHROOMS with damp satin caps, matte fibrous stems and finely readable gills.",
  fruit: "Finish FRUIT with porous peel, subtle waxy clearcoat, juicy color variation and natural stem contact shadows.",
  fabric: "Finish FABRIC with translucent woven organza, soft fiber sheen, visible weave, layered folds and airy shadow between layers.",
  crystal: "Finish CRYSTALS with transparent violet depth, sharp prismatic refraction, internal fractures and brilliant edge highlights.",
  feather: "Finish FEATHERS with thousands of fine separated matte barbs, satin shafts and soft directional sheen.",
  ribbon: "Finish RIBBON with rich satin anisotropic sheen, visible woven fibers, crisp folded highlights and soft shadowed backs.",
  lily: "Finish LILY-OF-THE-VALLEY with porcelain-thin translucent bells, fresh waxy leaves and moist green stems.",
  rose: "Finish ROSES with velvety layered petals, subtle translucent rims, waxy calyxes and thorned stems.",
};

// Bump this whenever the curated object cutouts are replaced. The generation
// route must see the same current artwork that visitors see on the table.
const OBJECT_REFERENCE_VERSION = "20261014c";

// These are construction actions, not interchangeable decorations. Keep the
// user's clay contour fixed while making each selected object unmistakable.
const OBJECT_SIGNATURES: Record<string, string> = {
  cloud: "Cloud changes the body into connected billowing volume inside its original contour; soft vapor escapes only at small edges.",
  metal: "Metal follows the sculpted bends as interlocking reflective plates and folded seams, never a generic chrome sphere.",
  sand: "Sand follows the carved form as compact dunes and granular erosion, with ridges flowing around its actual pinches.",
  stone: "Stone reveals the exact sculpted mass through chipped strata and fractures that follow its lobes and valleys.",
  light: "Bubble film follows the locked outline as joined transparent chambers; iridescent rims emphasize its original asymmetry.",
  ice: "Ice preserves the core contour with translucent glacial layers, cracks and a few small icicle tips.",
  chrome: "Glass turns the same sculpted contour into a thick optical lens with clear internal depth and luminous edges.",
  moss: "Moss grows as dense short fibers over the original shape; vary tuft length without turning it into a round bush.",
  wood: "Soil retains the sculpted silhouette as compact earth with eroded channels, roots and loose grains at creases.",
  cocoon: "Salt builds powdery and cubic mineral layers along the sculpted surface, preserving its irregular outline.",
  water: "Water holds the sculpted contour as one coherent liquid mass with surface tension, flowing highlights and few droplets.",
  flower: "Wildflowers emerge on separate curved stems from different surface regions and bloom outward at staggered heights; petals have space to open.",
  leaf: "Leaves unfurl from branching petioles around different sides, with some tips curling away from the surface.",
  branch: "Branches grow from several attachment points, fork into open space and trace different directions instead of forming a wreath.",
  mushroom: "Mushrooms sprout as a varied colony, from tiny low caps to tall stems and overlapping oyster shelves at different heights.",
  fruit: "Fruit hangs from short stems under gravity at several heights; never turn fruit into a printed pattern or identical repeated balls.",
  fabric: "One generous sheet of sheer organza embraces and partly envelops the whole sculpted body, catching on its actual protrusions; flowing hems and deep folds remain visibly cloth.",
  crystal: "Crystals erupt outward in unequal clusters from sculpted ridges, with long points and tiny shards separated by open space.",
  feather: "Feathers lift and fan around the body at different depths; a few selected feathers float very close around it, visibly belonging to the same sculptural arrangement.",
  ribbon: "One continuous satin ribbon whirls around the actual sculpted form in loose three-dimensional loops, crossing in front and behind with a long free tail and real gaps beneath it.",
  lily: "Lily-of-the-valley arches outward on slender stems; hanging bells cascade naturally at different heights, with leaves near their roots.",
  rose: "Roses climb from distinct thorned stems; layered blooms and small buds open at different sizes and orientations around the form.",
};

type Placement = { id: string; normal: [number, number, number] };

function placementDescription({ id, normal: [x, y, z] }: Placement) {
  const height = y > .35 ? "upper" : y < -.35 ? "lower" : "middle";
  const side = x > .35 ? "right" : x < -.35 ? "left" : "center";
  const face = z > .35 ? "front" : z < -.35 ? "back" : "side";
  return `${id.toUpperCase()}: ${height} ${side} ${face}`;
}

async function fetchPublicAsset(request: Request, path: string) {
  const response = await fetch(new URL(path, request.url), { cache: "no-store" });
  if (!response.ok) throw new Error(`Missing reference asset: ${path}`);
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || (path.endsWith(".png") ? "image/png" : "image/jpeg"),
  };
}

type BackgroundImageResponse = {
  id?: string;
  status?: "queued" | "in_progress" | "completed" | "failed" | "incomplete" | "cancelled";
  output?: Array<{ type?: string; status?: string; result?: string }>;
  error?: { message?: string; type?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

function parseOpenAIResponse(raw: string): BackgroundImageResponse {
  try { return JSON.parse(raw) as BackgroundImageResponse; } catch { return {}; }
}

function generatedImage(result: BackgroundImageResponse) {
  return result.output?.find((item) => item.type === "image_generation_call" && typeof item.result === "string")?.result;
}

function imageApiError(status: number, result: BackgroundImageResponse) {
  if (result.error?.code === "credit_balance_exhausted" || result.error?.code === "insufficient_quota") return "이미지 생성 API 크레딧 또는 사용 한도가 부족합니다. API 결제와 사용 한도를 확인한 뒤 이 화면에서 다시 만들기를 눌러주세요.";
  if (status === 401) return "이미지 생성 인증을 확인하고 있습니다. 잠시 후 다시 시도해주세요.";
  if (status === 429) return "이미지 생성 요청이 많습니다. 잠시 후 다시 시도해주세요.";
  if (status === 400) return "선택한 오브젝트 이미지를 처리하지 못했습니다. 초기화하지 말고 다시 시도해주세요.";
  if (result.error?.message) return "이미지 생성 요청을 처리하지 못했습니다. 초기화하지 말고 다시 시도해주세요.";
  return "이미지 생성 서버 연결이 잠시 끊겼습니다. 초기화하지 말고 다시 시도해주세요.";
}

function assetDataUrl(asset: { bytes: ArrayBuffer; contentType: string }) {
  return `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "이미지 생성 키가 설정되지 않았습니다." }, { status: 503 });

  try {
    const body = await request.json() as { silhouette?: string; objects?: string[]; placements?: Placement[] };
    if (!body.silhouette?.startsWith("data:image/png;base64,") || !Array.isArray(body.objects) || !body.objects.every((id) => typeof id === "string" && id in MATERIAL_PROMPTS)) {
      return NextResponse.json({ error: "클레이 형태 또는 오브젝트 정보가 없습니다." }, { status: 400 });
    }

    const selectedObjects = [...new Set(body.objects)].slice(0, 4);
    const placements = Array.isArray(body.placements) ? body.placements.filter((placement) =>
      placement && selectedObjects.includes(placement.id) && Array.isArray(placement.normal)
      && placement.normal.length === 3 && placement.normal.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1.01),
    ).slice(0, 4) : [];
    const baseMaterials = selectedObjects.filter((id) => BASE_MATERIAL_IDS.has(id));
    const attachments = selectedObjects.filter((id) => !BASE_MATERIAL_IDS.has(id));
    const attachmentPlacements = placements.filter((placement) => attachments.includes(placement.id));
    const allowList = selectedObjects.map((id) => id.toUpperCase()).join(", ");
    const selectedDescriptions = selectedObjects.map((id) => MATERIAL_PROMPTS[id]).join(" ");
    const selectedFinishDescriptions = selectedObjects.map((id) => MATERIAL_FINISH_PROMPTS[id]).join(" ");
    const baseRule = baseMaterials.length
      ? baseMaterials.length === 1
        ? `${baseMaterials[0].toUpperCase()} is the sole whole-body base material. Replace 100% of the visible white clay exterior with this material while preserving the supplied silhouette as a hidden armature. No white or cream clay may remain visible in any view.`
        : `${baseMaterials.map((id) => id.toUpperCase()).join(" and ")} are the only whole-body base materials. Interweave them across the entire sculpted exterior with irregular, gradual transitions and small recurring areas of each material. Avoid a hard half-and-half divide, bilateral color block or single straight boundary. Every selected base must remain readable and no white or cream clay may remain visible.`
      : "No whole-body base material was selected. Preserve the supplied neutral white Muse body as the visible base and add only the selected attachment objects to it.";
    const attachmentRule = attachments.length
      ? `These are attachment or growth objects only: ${attachments.map((id) => id.toUpperCase()).join(", ")}. They must grow, bloom, hang, protrude, drape or wrap naturally ON TOP of the base according to their individual behavior. Keep them three-dimensional and visibly connected to the body, except selected feather plumes or free fabric/ribbon ends moving immediately around it. Do not melt them into the base skin.`
      : "No attachment object was selected. Do not invent flowers, leaves, branches, fruit, mushrooms, crystals, feathers, fabric, ribbon or any other decoration.";

    // Only the currently selected cutouts are sent as visual object references.
    // The established MUSE construction grammar is encoded in text below so unrelated
    // objects from older reference pieces can never leak into a visitor's artifact.
    const selectedObjectAssets = await Promise.all(
      selectedObjects.map((id) => fetchPublicAsset(request, `/objects/${id}.png?v=${OBJECT_REFERENCE_VERSION}`)),
    );

    const selectedImageManifest = selectedObjects.map((id, index) => `Image ${index + 2} is the exact ${id.toUpperCase()} object reference`).join("; ");
    const buildPrompt = () => [
      "Edit the supplied references into one square 2-by-2 orthographic turnaround sheet of one premium photoreal three-dimensional Muse artifact.",
      "IMAGE ROLES ARE STRICT. Image 1 is the exact 2-by-2 clay geometry sheet and is the non-negotiable geometry blueprint. It controls the core body's silhouette, proportions, orientation, bulges, pinches, concavities, asymmetry and camera views.",
      "GEOMETRY LOCK: trace the outer contour and all visible shape landmarks from Image 1 as closely as possible in every quadrant. Keep every stretched lobe, narrow waist, flat area, indentation and off-center mass in the same location and proportion. Do not beautify, normalize, round, inflate, symmetrize, straighten or redesign the sculpted body. Material may replace its surface, but the underlying sculpted form must stay recognizably the same.",
      "Treat each quadrant of Image 1 as a fixed tracing template for the core body, not a loose mood board. Keep its width-to-height ratio, center of mass, protrusion angles, concave gaps and negative space. The core must still match when the added objects are mentally removed. Never substitute a familiar vase, orb, egg, flower pot or stock sculpture for the user's shape.",
      selectedImageManifest ? `${selectedImageManifest}. These exact current cutouts are the sole visual source of truth for the selected objects and the ONLY visual sources for every added object. Reproduce their specific silhouette, species, color palette, texture, material, transparency and distinctive details with near pixel-level fidelity. Never replace them with a generic object from the same category.` : "There are no selected object cutout references.",
      "No general style-reference image is present. Apply the written MUSE construction grammar only: one coherent sculptural body, with selected natural objects growing from it and selected fabric-like objects wrapping it. Never infer or add a decorative object from prior examples.",
      "The four equal quadrants must be, in this exact order: TOP LEFT front view, TOP RIGHT left-side view, BOTTOM LEFT back view, BOTTOM RIGHT right-side view.",
      "Use the supplied front, side and back geometry instead of inventing or mirroring the reverse side. Every quadrant must show the same artifact with identical geometry, selected materials, attachment positions, scale, camera height and lighting.",
      "Center and fully contain the artifact inside every quadrant with generous margin. Do not crop any protruding part.",
      `ABSOLUTE ALLOW LIST: ${allowList || "NO ADDED OBJECTS"}. The selected list is exhaustive. Render every selected type and render ZERO unselected object types, filler plants, generic decorations, extra materials or borrowed items from the Muse references. If it is not selected, it must not appear.`,
      `EXACT OBJECT COUNT AUDIT: the only permitted categories are ${allowList || "NONE"}. Before rendering each quadrant, inspect every visible detail and remove anything whose category is not in this list. Natural stems, calyxes and leaves that belong to a selected flower, lily, rose or fruit are part of that selected object; do not add a separate unselected leaf arrangement, filler moss, bubbles, stones, crystals or cloth.`,
      baseRule,
      attachmentRule,
      "Attachments may extend beyond the core body only according to their natural behavior, but they must sit on the locked sculpted surface without swelling, replacing or reshaping that core geometry.",
      selectedDescriptions ? `INDIVIDUAL PHYSICAL BEHAVIOR: ${selectedDescriptions}` : "",
      `SIGNATURE ACTIONS FOR THIS EXACT SELECTION: ${selectedObjects.map((id) => OBJECT_SIGNATURES[id]).join(" ")}`,
      attachments.length ? `Make ${attachments[0].toUpperCase()} the most visually expressive gesture in this particular result; give ${attachments.slice(1).map((id) => id.toUpperCase()).join(", ") || "no other attachment"} distinct supporting roles. Their different motion, growth and scale must make this combination recognizable at a glance. Do not default to the same balanced wreath, uniform scatter, spiral of small objects or repeated cluster arrangement for every visitor.` : "The selected base material or combination itself carries the distinct visual character; do not add ornamental attachments.",
      attachmentPlacements.length ? `USER PLACEMENT ANCHORS, in the orientation of Image 1's front view: ${attachmentPlacements.map(placementDescription).join("; ")}. Use these as focal emergence points while spreading additional growth naturally across the other visible faces. Keep each type in corresponding locations across all four views; do not pile everything on one side.` : attachments.length ? "Distribute selected attachments over multiple visible faces of the core, with intentional negative space and natural variation in size and height." : "",
      selectedFinishDescriptions ? `MATERIAL IDENTITY IS MANDATORY IN EVERY VIEW: ${selectedFinishDescriptions}` : "",
      "Render physically distinct PBR-ready surfaces with readable roughness, metalness, transmission, refraction, sheen, fibers, grains, pores and micro-relief appropriate to each selected object. Lighting must reveal these material differences clearly. Do not collapse different selected objects into the same smooth plastic shader.",
      "When selected, ribbon may have airborne tails, fabric may have floating hems and feathers may hover very near the body. These are parts of the selected object itself, not unrelated extra objects. Their path and physical relation to the core must stay consistent across all four views.",
      "Do not reveal the bent white clay support when a whole-body base material is selected. Preserve its topology only, as a completely hidden armature beneath the chosen material.",
      "Do not add labels, text, logos, dividers, frames, a floor, a pedestal, scenery, loose debris or unrelated detached objects.",
      "Before rendering, mentally align each output view over the matching quadrant of Image 1 and correct any contour drift. Show identical fixed attachment locations and wrapping paths rotated across all four views, with physically consistent occlusion and visible back-side growth. Use a seamless pure-white studio background in every quadrant, soft neutral studio light, consistent realistic depth and volume, highly detailed product photography.",
      ].filter(Boolean).join(" ");

    const startBackgroundImageEdit = async () => {
      const content: Array<Record<string, string>> = [
        { type: "input_text", text: buildPrompt() },
        { type: "input_image", image_url: body.silhouette!, detail: "high" },
        ...selectedObjectAssets.map((asset) => ({ type: "input_image", image_url: assetDataUrl(asset), detail: "high" })),
      ];
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.2",
          background: true,
          store: false,
          input: [{ role: "user", content }],
          tools: [{
            type: "image_generation",
            model: "gpt-image-2",
            action: "edit",
            // Four views share this sheet; 1920px gives Tripo 960px per view.
            size: "1920x1920",
            quality: "high",
            background: "opaque",
            output_format: "png",
          }],
          tool_choice: { type: "image_generation" },
        }),
      });
      const raw = await response.text();
      const result = parseOpenAIResponse(raw);
      return { response, result };
    };

    const { response, result } = await startBackgroundImageEdit();
    if (!response.ok || !result.id) {
      console.error("[generate-world] OpenAI background image edit failed to start.", {
        status: response.status,
        code: result.error?.code,
        type: result.error?.type,
        message: result.error?.message,
      });
      return NextResponse.json({ error: imageApiError(response.status, result), code: result.error?.code }, { status: response.status || 500 });
    }
    const image = generatedImage(result);
    if (image) return NextResponse.json({ status: "completed", image: `data:image/png;base64,${image}` });
    return NextResponse.json({ taskId: result.id, status: result.status ?? "queued" }, { status: 202 });
  } catch (error) {
    console.error("[generate-world] Request handling failed.", error);
    return NextResponse.json({ error: "이미지 생성 요청을 처리하지 못했습니다." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "이미지 생성 키가 설정되지 않았습니다." }, { status: 503 });
  const taskId = new URL(request.url).searchParams.get("taskId") ?? "";
  if (!/^resp_[A-Za-z0-9_-]{8,160}$/.test(taskId)) {
    return NextResponse.json({ error: "이미지 생성 작업을 찾지 못했습니다." }, { status: 400 });
  }
  try {
    const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const raw = await response.text();
    const result = parseOpenAIResponse(raw);
    if (!response.ok) {
      console.error("[generate-world] OpenAI background image status failed.", {
        taskId,
        status: response.status,
        code: result.error?.code,
        type: result.error?.type,
        message: result.error?.message,
      });
      return NextResponse.json({ error: imageApiError(response.status, result), code: result.error?.code, terminal: true }, { status: response.status || 500 });
    }
    const image = generatedImage(result);
    if (result.status === "completed" && image) {
      return NextResponse.json({ status: "completed", image: `data:image/png;base64,${image}` });
    }
    if (result.status === "queued" || result.status === "in_progress") {
      return NextResponse.json({ status: result.status });
    }
    console.error("[generate-world] OpenAI background image reached a terminal state without an image.", {
      taskId,
      status: result.status,
      code: result.error?.code,
      type: result.error?.type,
      message: result.error?.message,
      incompleteReason: result.incomplete_details?.reason,
    });
    return NextResponse.json({
      error: imageApiError(result.error?.code === "credit_balance_exhausted" ? 402 : 502, result),
      code: result.error?.code,
      terminal: true,
    }, { status: 502 });
  } catch (error) {
    console.error("[generate-world] Background image status handling failed.", error);
    return NextResponse.json({ error: "이미지 생성 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
  }
}
