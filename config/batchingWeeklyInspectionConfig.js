export const BATCHING_WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const BATCHING_WORK_DAYS = BATCHING_WEEK_DAYS.slice(0, 5);

export const BATCHING_INSPECTION_CONFIG = {
  kind: "batching_weekly_inspection_v1",
  title: "Batching Plant Weekly Inspection",
  sheets: [
    {
      key: "health_and_safety",
      title: "Health & Safety",
      dailySections: [
        {
          key: "daily_guard_checks",
          title: "Daily Guard Checks",
          mode: "daily_log",
          days: BATCHING_WEEK_DAYS,
          instruction:
            "All guards must be checked prior to production commencing to ensure they are safe, secure and in position.",
        },
        {
          key: "plant_maintenance_daily",
          title: "Plant Maintenance Daily Checks",
          mode: "task_initials",
          days: BATCHING_WORK_DAYS,
          tasks: [
            "Is control room clean and tidy",
            "Is plant free from spillage and waste",
            "Are risk assessments available and controls adequate",
            "Can the site be secured",
            "Clean and washed down plant",
            "Check tracking on all belts",
            "Clean and adjust scrapers if necessary",
            "Check paddles/liners and replace as necessary",
            "Check generator and compressor (fuel, oil, water)",
            "Drain airline water traps and top up airline oils",
            "Drain water pumps, lines and supply (winter only)",
          ],
        },
      ],
      weeklySections: [
        {
          key: "weekly_equipment_checks",
          title: "Weekly Equipment Checks",
          fields: ["checked_by", "day"],
          tasks: [
            "Pull cords working effectively?",
            "Emergency stops working effectively?",
            "Ladders all locked and secured?",
            "Interlock systems all working effectively?",
            "Steps and walkways clear of trip hazards?",
            "Plant lighting all working and adequate?",
            "Fire extinguishers all in date and good order?",
            "RCD's all tested and functional?",
            "Ladder inspections in date (daily / 6 monthly)",
            "First aid kit / eye wash available and in date",
            "Small tools inspections carried out and items tagged",
          ],
        },
        {
          key: "plant_maintenance_weekly",
          title: "Plant Maintenance Weekly Checks",
          fields: ["checked_by", "defect_reported"],
          tasks: [
            "Have all bearings been greased as required?",
            "Are all conveyor rollers running and free from build up?",
            "Are grizzly's free from damage and wear?",
            "Are all conveyor skirts / boots free from wear / build up",
            "Are all conveyor covers in place and secured",
            "Are all airlines / cement pipes connected using whip arrestors",
            "Cement pipe / water pipe free from wear / leaks",
          ],
        },
      ],
    },
    {
      "key": "environmental",
      "title": "Environmental",
      "dailySections": [
        {
          "key": "daily_logbook",
          "title": "Environmental Logbook",
          "mode": "timed_logbook",
          "days": BATCHING_WEEK_DAYS,
          "groups": [
            {
              "key": "pre_start",
              "title": "Pre Start",
              "instruction": "Carry out check of engines to ensure that there is no smoke whilst engines running normally and no airborne emissions are leaving the site boundary.",
              "slots": ["pre_start"]
            },
            { "key": "A", "title": "Check plant, compound and structures are free of dust and spillage", "slots": ["am", "pm"] },
            { "key": "B", "title": "Check that any additional processing plant is not producing airborne dust or spillage of water / oils.", "slots": ["am", "pm"] },
            { "key": "C", "title": "Check that waste material handling and storage areas are free from spillage", "slots": ["am", "pm"] },
            { "key": "D", "title": "Check batching compound is free from airborne dust and litter blowing and haul routes are dust and slurry free.", "slots": ["am", "pm"] },
            { "key": "E", "title": "Check from a point downwind that there are no emissions of dust, odours, smoke or noise that could cause impact outside of the site boundary.", "slots": ["am", "pm"] },
            { "key": "F", "title": "Weather condition code (D = Dry, R = Raining, V = Variable, S = Snow)", "slots": ["am", "pm"] }
          ]
        },
        {
          "key": "powder_deliveries",
          "title": "Powder Deliveries",
          "mode": "repeatable_deliveries",
          "days": BATCHING_WEEK_DAYS
        },
        {
          "key": "emissions_ratings",
          "title": "Visual Assessment Of Emissions To Air",
          "mode": "area_rating",
          "days": BATCHING_WEEK_DAYS,
          "areas": [
            "Stock Pile Area",
            "Loadout Area From Delivery Conveyor",
            "Valves and Socks",
            "Aggregate Hoppers",
            "Top of the Silo",
            "Weigh Hopper Venting Pipe",
            "Conveyors"
          ],
          "ratings": ["1", "2", "3", "4"]
        }
      ],
      "weeklySections": [
        {
          "key": "environmental_weekly_checks",
          "title": "Environmental Weekly Checks",
          "fields": ["checked_by", "defect_reported", "day", "time"],
          "tasks": [
            "Silo high level warning system fully operational",
            "Pressure release valve raising and lowering correctly",
            "Silo reverse jet filters operational and clean",
            "Weigh hopper reverse jet filters clean and operational",
            "Automatic shut off valves operational and free from wear",
            "Socks free from wear and build up (silo, vane, chute)",
            "Check that fuel tank bund is empty, pipework isn't leaking and contents gauges are working accurately",
            "Waste oil disposed of from site via correct means",
            "All oil and COSHH materials locked away, labelled and bunded",
            "Oil and fuel spill kits available and clearly visible"
          ]
        }
      ]
    },
    {
      key: "quality",
      title: "Quality",
      dailySections: [
        {
          key: "quality_daily_checks",
          title: "Daily Quality Checks",
          mode: "task_am_pm_status",
          days: BATCHING_WORK_DAYS,
          slots: ["am", "pm"],
          tasks: [
            "Aggregate moistures taken and recorded",
            "Mixed materials moisture checks taken",
            "Delivered material moistures carried out",
            "All loads mixed within specification of mix",
            "Delivered materials of good quality",
            "Stock piles free from contamination",
            "Are flow rates/speeds as per calibration",
            "Zero calibrations carried out and recorded",
            "Scales calibrated using test weights",
            "Temperature gauge working",
            "Water quality (ph value)",
            "Powder sample received (BENTONITE ONLY)",
            "Temperature readings recorded on batch records",
          ],
        },
      ],
      weeklySections: [
        {
          key: "quality_weekly_checks",
          title: "Quality Weekly Checks",
          fields: ["checked_by", "defect_reported", "day", "time"],
          tasks: [
            "All stockpiles clearly labelled",
            "Aggregate bins labelled",
            "Are all loadcells free from obstructions",
            "Cement weigh hopper / breather free from material",
            "Material / supplier signs fitted and visible on silo pipes",
            "Admixture pipes clearly labelled",
            "Are up to date plant specific batching instructions available",
            "Cement within 12 months",
            "Water within 12 months",
            "Admixtures within 12 months",
            "Aggregate within 12 months (CBM, BES) / 12 months (concrete)",
            "Moisture probes within 12 months",
            "Calibration weights tested within 12 months",
            "Crane scale calibrated within 12 months",
            "Aggregate stock reconciliation carried out",
            "Cement reconciliation carried out",
          ],
        },
      ],
    },
  ],
};

export const BATCHING_STATUS_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "na", label: "N/A" },
];
