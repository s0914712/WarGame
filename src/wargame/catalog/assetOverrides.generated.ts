/**
 * 由 `npm run assets:import` 從 wargame-assets.xlsx 產生 — 請勿手動修改。
 * 只記錄與程式內建數值「不同」的欄位。
 */
import type { AssetOverrides } from "./assetOverrides";

export const ASSET_OVERRIDES: AssetOverrides = {
  "kinds": {
    "missile_launcher": {
      "core": {
        "detectionRangeKm": 0,
        "rangeKm": 150
      },
      "loadout": [
        {
          "weaponId": "asm",
          "ammoMax": 4,
          "rangeKm": 150
        }
      ]
    },
    "drone": {
      "core": {
        "detectionRangeKm": 100,
        "movementRangeKm": 100
      },
      "loadout": [
        {
          "weaponId": "asm",
          "ammoMax": 1,
          "rangeKm": 10
        },
        {
          "weaponId": "torpedo",
          "ammoMax": 0,
          "rangeKm": 15
        }
      ]
    },
    "ship_surface": {
      "core": {
        "detectionRangeKm": 100
      },
      "loadout": [
        {
          "weaponId": "sam_ship",
          "ammoMax": 8,
          "rangeKm": 150
        },
        {
          "weaponId": "ciws",
          "ammoMax": 200,
          "rangeKm": 1
        },
        {
          "weaponId": "asm",
          "ammoMax": 8,
          "rangeKm": 150
        },
        {
          "weaponId": "torpedo",
          "ammoMax": 4,
          "rangeKm": 5
        }
      ]
    },
    "submarine": {
      "core": {
        "detectionRangeKm": 10
      },
      "loadout": [
        {
          "weaponId": "torpedo",
          "ammoMax": 6,
          "rangeKm": 5
        },
        {
          "weaponId": "asm",
          "ammoMax": 2,
          "rangeKm": 120
        }
      ]
    },
    "radar_station": {
      "core": {
        "detectionRangeKm": 200
      }
    },
    "sam_coastal": {
      "core": {
        "detectionRangeKm": 0,
        "rangeKm": 150
      },
      "loadout": [
        {
          "weaponId": "sam_coast",
          "ammoMax": 4,
          "rangeKm": 120
        }
      ]
    },
    "fighter": {
      "loadout": [
        {
          "weaponId": "aam",
          "ammoMax": 4,
          "rangeKm": 30
        },
        {
          "weaponId": "asm",
          "ammoMax": 2,
          "rangeKm": 60
        }
      ]
    },
    "sam_patriot": {
      "loadout": [
        {
          "weaponId": "sam_patriot",
          "ammoMax": 16,
          "rangeKm": 120
        }
      ]
    }
  },
  "weapons": {},
  "units": {}
};
