import type { Scenario, ScenarioBundle } from "../src/types.js"
import { dinnerSimulatedUser } from "../src/simulatedUser.js"
import { dinnerJudge } from "../src/evaluator.js"

export const dinnerOffsiteScenario: Scenario = {
  id: "dinner_offsite_001",
  title: "Plan the team offsite dinner",
  timeline: [
    {
      timestamp: "2026-05-01T09:00:00-07:00",
      message:
        "For future work dinners, I prefer not to start before 7pm. I always feel rushed before then.",
    },
    {
      timestamp: "2026-05-03T11:00:00-07:00",
      message:
        "Priya is vegetarian, so make sure team meals have real vegetarian options, not just salad.",
    },
    {
      timestamp: "2026-05-04T14:30:00-07:00",
      message:
        "Miguel avoids shellfish. Not allergic, but seafood-heavy places aren't great when he's joining.",
    },
    {
      timestamp: "2026-05-08T16:00:00-07:00",
      message: "For next week's offsite, the team chose Italian over sushi.",
    },
    {
      timestamp: "2026-05-09T10:00:00-07:00",
      message: "Let's keep dinner around $80/person if possible.",
    },
    {
      timestamp: "2026-05-10T12:00:00-07:00",
      message: "We're staying near Union Square for the offsite.",
    },
  ],
  finalTask: {
    timestamp: "2026-05-14T10:00:00-07:00",
    message: "Can you plan the team offsite dinner for Wednesday, May 20?",
  },
}

export const dinnerOffsiteBundle: ScenarioBundle = {
  scenario: dinnerOffsiteScenario,
  simulatedUser: dinnerSimulatedUser,
  judge: dinnerJudge,
  requiredFields: ["partySize"],
}
