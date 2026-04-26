import type {
  Restaurant,
  RestaurantSearchArgs,
  HoldReservationArgs,
  ToolCall,
  ToolResult,
} from "./types.js"

export const RESTAURANTS: Restaurant[] = [
  {
    id: "rest_001",
    name: "Sakura Omakase",
    cuisine: "Japanese",
    neighborhood: "Union Square",
    priceEstimatePerPerson: 95,
    availableTimes: ["18:00", "19:30"],
    description: "Seafood-forward omakase counter with limited substitutions.",
    menuHighlights: ["uni", "toro", "shellfish tasting", "miso soup"],
    dietaryNotes: "Limited vegetarian options.",
  },
  {
    id: "rest_002",
    name: "Bella Tavola",
    cuisine: "Italian",
    neighborhood: "Union Square",
    priceEstimatePerPerson: 72,
    availableTimes: ["18:30", "19:30", "20:00"],
    description:
      "Warm Italian trattoria with house pastas, seasonal vegetables, and private dining.",
    menuHighlights: [
      "mushroom pappardelle",
      "eggplant parmesan",
      "branzino",
      "tiramisu",
    ],
    dietaryNotes: "Several vegetarian mains available.",
  },
  {
    id: "rest_003",
    name: "Harbor & Pearl",
    cuisine: "Seafood",
    neighborhood: "Embarcadero",
    priceEstimatePerPerson: 88,
    availableTimes: ["19:00", "20:15"],
    description:
      "Seafood restaurant focused on oysters, crab, shellfish towers, and coastal wines.",
    menuHighlights: [
      "oysters",
      "lobster roll",
      "shellfish platter",
      "clam linguine",
    ],
    dietaryNotes: "Vegetarian sides available.",
  },
  {
    id: "rest_004",
    name: "North Beach Pasta House",
    cuisine: "Italian",
    neighborhood: "North Beach",
    priceEstimatePerPerson: 68,
    availableTimes: ["19:15", "20:00"],
    description:
      "Casual Italian spot with pastas, salads, and several vegetarian options.",
    menuHighlights: ["cacio e pepe", "margherita pizza", "vegetable lasagna"],
    dietaryNotes: "Good vegetarian options.",
  },
  {
    id: "rest_005",
    name: "Taqueria El Farolito",
    cuisine: "Mexican",
    neighborhood: "Mission",
    priceEstimatePerPerson: 28,
    availableTimes: ["12:00", "12:30", "13:00", "13:30"],
    description:
      "Beloved Mission taqueria; massive burritos and fresh salsas. Counter service.",
    menuHighlights: ["super burrito", "tofu burrito", "carne asada"],
    dietaryNotes: "Tofu and bean options for vegetarians.",
  },
  {
    id: "rest_006",
    name: "Nopalito",
    cuisine: "Mexican",
    neighborhood: "Mission",
    priceEstimatePerPerson: 52,
    availableTimes: ["12:00", "12:30", "13:00"],
    description:
      "Sit-down regional Mexican kitchen; sustainably sourced; strong vegetarian menu.",
    menuHighlights: [
      "queso fundido",
      "ensalada de nopales",
      "enchiladas de mole",
      "carnitas",
    ],
    dietaryNotes: "Several full vegetarian mains; vegan options on request.",
  },
  {
    id: "rest_007",
    name: "La Taqueria",
    cuisine: "Mexican",
    neighborhood: "Mission",
    priceEstimatePerPerson: 22,
    availableTimes: ["12:00", "12:30", "13:00", "13:30"],
    description: "Iconic Mission burrito joint; meat-forward; limited vegetarian.",
    menuHighlights: ["carne asada burrito", "al pastor taco"],
    dietaryNotes: "Limited vegetarian options.",
  },
]

// v0.6: search actually filters by the args. Agents that don't pass relevant args
// get back the full universe and must reason; agents that DO pass args get a
// narrower, more useful result. This makes "did the agent translate memory into
// the API call" an observable, scorable behavior — not just a downstream choice.
function isVegetarianFriendly(r: Restaurant): boolean {
  const notes = r.dietaryNotes.toLowerCase()
  if (notes.includes("limited vegetarian")) return false
  return (
    notes.includes("vegetarian") ||
    /vegetable|veggie|tofu|eggplant|mushroom/i.test(r.menuHighlights.join(" ")) ||
    /vegetarian/i.test(r.description)
  )
}

function isShellfishHeavy(r: Restaurant): boolean {
  const blob = `${r.description} ${r.menuHighlights.join(" ")}`.toLowerCase()
  // "Heavy" = multiple shellfish references OR a shellfish-forward description
  const shellfishHits = (blob.match(/oyster|shellfish|lobster|crab|shrimp|clam|mussel|scallop|prawn/gi) ?? []).length
  return shellfishHits >= 2 || /seafood-(forward|focused|heavy)|shellfish (tower|tasting|platter)/i.test(blob)
}

export function searchRestaurants(args: RestaurantSearchArgs): Restaurant[] {
  return RESTAURANTS.filter((r) => {
    if (
      args.location &&
      !r.neighborhood.toLowerCase().includes(args.location.toLowerCase())
    ) {
      return false
    }
    if (
      args.cuisine &&
      r.cuisine.toLowerCase() !== args.cuisine.toLowerCase()
    ) {
      return false
    }
    if (
      args.maxPricePerPerson !== undefined &&
      r.priceEstimatePerPerson > args.maxPricePerPerson
    ) {
      return false
    }
    if (args.requiresVegetarian && !isVegetarianFriendly(r)) {
      return false
    }
    if (args.avoidShellfish && isShellfishHeavy(r)) {
      return false
    }
    if (args.time && !r.availableTimes.includes(args.time)) {
      // Soft filter: drop restaurants with NO availability at the requested time.
      return false
    }
    return true
  })
}

export function holdReservation(args: HoldReservationArgs) {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurantId)
  if (!restaurant) {
    return {
      success: false,
      message: `Restaurant ${args.restaurantId} not found.`,
    }
  }
  if (!restaurant.availableTimes.includes(args.time)) {
    return {
      success: false,
      message: `${restaurant.name} is not available at ${args.time}.`,
    }
  }
  return {
    success: true,
    reservationId: `res_${args.restaurantId}_${args.time.replace(":", "")}`,
    message: `Held reservation at ${restaurant.name} for ${args.partySize} people at ${args.time}.`,
  }
}

export function executeToolCall(toolCall: ToolCall): ToolResult {
  if (toolCall.tool === "restaurants.search") {
    return {
      tool: "restaurants.search",
      args: toolCall.args,
      result: searchRestaurants(toolCall.args),
    }
  }
  return {
    tool: "restaurants.holdReservation",
    args: toolCall.args,
    result: holdReservation(toolCall.args),
  }
}
