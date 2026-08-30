import { metersPerDegree, wgs84ToHk80, assertWgs84, wgs84RingAreaM2 } from "./crs";
import type {
  BuildingFeature,
  BuildingFeatureCollection,
  BuildingProperties,
  DistrictName,
  LonLat,
} from "./types";
import { hashString, mulberry32, roundTo } from "./utils";

interface LotOverride {
  slug: string;
  nameEn: string;
  nameZh: string;
  address: string;
  height?: number;
  subdividedFlatDensity?: number;
  elderlyRatio?: number;
  povertyIndex?: number;
  acAnthropogenicHeat?: number;
  ventilationBlockage?: number;
  baselineCVDPrevalence?: number;
  widthM?: number;
  depthM?: number;
}

interface StreetBlueprint {
  id: string;
  nameEn: string;
  nameZh: string;
  district: DistrictName;
  headingDeg: number;
  start: LonLat;
  end: LonLat;
  side: 1 | -1;
  setbackM: number;
  priors: {
    height: [number, number];
    subdividedFlatDensity: [number, number];
    elderlyRatio: [number, number];
    povertyIndex: [number, number];
    acAnthropogenicHeat: [number, number];
    ventilationBlockage: [number, number];
    baselineCVDPrevalence: [number, number];
    widthM: [number, number];
    depthM: [number, number];
  };
  lots: LotOverride[];
}

const STREETS: StreetBlueprint[] = [
  {
    id: "pei-ho",
    nameEn: "Pei Ho Street",
    nameZh: "北河街",
    district: "Sham Shui Po",
    headingDeg: 8,
    start: [114.16348, 22.32852],
    end: [114.16372, 22.33188],
    side: 1,
    setbackM: 7.5,
    priors: {
      height: [18, 34],
      subdividedFlatDensity: [0.62, 0.94],
      elderlyRatio: [0.32, 0.61],
      povertyIndex: [0.48, 0.86],
      acAnthropogenicHeat: [55, 145],
      ventilationBlockage: [0.58, 0.92],
      baselineCVDPrevalence: [11.5, 21.4],
      widthM: [10.5, 15.5],
      depthM: [16, 24],
    },
    lots: [
      { slug: "ph-58", nameEn: "Pei Ho St Tong Lau", nameZh: "北河街唐樓", address: "58", subdividedFlatDensity: 0.91, elderlyRatio: 0.58, height: 21 },
      { slug: "ph-62", nameEn: "Kam Wah House", nameZh: "金華樓", address: "62", height: 24, ventilationBlockage: 0.84 },
      { slug: "ph-70", nameEn: "Pei Ho Court Walk-up", nameZh: "北河閣唐樓", address: "70", height: 19, povertyIndex: 0.81 },
      { slug: "ph-88", nameEn: "Yue Shing Building", nameZh: "裕盛樓", address: "88", height: 28, acAnthropogenicHeat: 128 },
      { slug: "ph-102", nameEn: "Wing On Mansion", nameZh: "永安大樓", address: "102", height: 31, subdividedFlatDensity: 0.77 },
      { slug: "ph-118", nameEn: "Chung Nam House", nameZh: "中南樓", address: "118", height: 22, elderlyRatio: 0.52 },
      { slug: "ph-126", nameEn: "Pei Ho Laneway Block", nameZh: "北河巷唐樓", address: "126", height: 17, ventilationBlockage: 0.9, subdividedFlatDensity: 0.93 },
      { slug: "ph-136", nameEn: "Hoi On Building", nameZh: "海安樓", address: "136", height: 26 },
      { slug: "ph-150", nameEn: "Shun Cheong House", nameZh: "順昌樓", address: "150", height: 23, povertyIndex: 0.74 },
      { slug: "ph-166", nameEn: "Pei Ho Terrace Tong Lau", nameZh: "北河臺唐樓", address: "166", height: 20, elderlyRatio: 0.6 },
    ],
  },
  {
    id: "fuk-wa",
    nameEn: "Fuk Wa Street",
    nameZh: "福華街",
    district: "Sham Shui Po",
    headingDeg: 98,
    start: [114.16152, 22.33108],
    end: [114.16462, 22.33096],
    side: -1,
    setbackM: 7,
    priors: {
      height: [16, 36],
      subdividedFlatDensity: [0.55, 0.9],
      elderlyRatio: [0.28, 0.57],
      povertyIndex: [0.42, 0.8],
      acAnthropogenicHeat: [48, 138],
      ventilationBlockage: [0.5, 0.88],
      baselineCVDPrevalence: [10.2, 19.8],
      widthM: [11, 16],
      depthM: [15, 22],
    },
    lots: [
      { slug: "fw-41", nameEn: "Fuk Wa Market Block", nameZh: "福華街市唐樓", address: "41", height: 18, subdividedFlatDensity: 0.88 },
      { slug: "fw-57", nameEn: "Tak Cheong Building", nameZh: "德昌樓", address: "57", height: 27 },
      { slug: "fw-73", nameEn: "Fuk Wa Street Tong Lau", nameZh: "福華街唐樓", address: "73", height: 21, elderlyRatio: 0.54 },
      { slug: "fw-89", nameEn: "Lucky House SSP", nameZh: "幸運樓", address: "89", height: 33, acAnthropogenicHeat: 152 },
      { slug: "fw-105", nameEn: "Wah Shing Mansion", nameZh: "華盛大樓", address: "105", height: 29 },
      { slug: "fw-121", nameEn: "Yen Chow Corner Block", nameZh: "欽州街角唐樓", address: "121", height: 24, ventilationBlockage: 0.86 },
      { slug: "fw-139", nameEn: "Fuk Wa Walk-up 139", nameZh: "福華街139號", address: "139", height: 16, povertyIndex: 0.79, subdividedFlatDensity: 0.9 },
      { slug: "fw-155", nameEn: "Shing Yip Building", nameZh: "成業樓", address: "155", height: 32 },
    ],
  },
  {
    id: "tai-nan",
    nameEn: "Tai Nan Street",
    nameZh: "大南街",
    district: "Sham Shui Po",
    headingDeg: 96,
    start: [114.16212, 22.32758],
    end: [114.16558, 22.3274],
    side: 1,
    setbackM: 6.8,
    priors: {
      height: [17, 38],
      subdividedFlatDensity: [0.48, 0.86],
      elderlyRatio: [0.24, 0.5],
      povertyIndex: [0.35, 0.72],
      acAnthropogenicHeat: [42, 132],
      ventilationBlockage: [0.46, 0.84],
      baselineCVDPrevalence: [9.4, 18.2],
      widthM: [10, 15],
      depthM: [16, 23],
    },
    lots: [
      { slug: "tn-88", nameEn: "Tai Nan Design Walk-up", nameZh: "大南街設計唐樓", address: "88", height: 19 },
      { slug: "tn-102", nameEn: "Nan Cheong House", nameZh: "南昌樓", address: "102", height: 25, subdividedFlatDensity: 0.71 },
      { slug: "tn-118", nameEn: "Tai Nan Street Tong Lau", nameZh: "大南街唐樓", address: "118", height: 22, elderlyRatio: 0.41 },
      { slug: "tn-136", nameEn: "Vintage Atelier Block", nameZh: "大南工房樓", address: "136", height: 28, acAnthropogenicHeat: 118 },
      { slug: "tn-150", nameEn: "Ki Lung Junction House", nameZh: "基隆街口唐樓", address: "150", height: 21, ventilationBlockage: 0.8 },
      { slug: "tn-166", nameEn: "Tai Nan Loft Mansion", nameZh: "大南閣", address: "166", height: 34 },
      { slug: "tn-182", nameEn: "Po On Approach Block", nameZh: "保安道口唐樓", address: "182", height: 18, povertyIndex: 0.66 },
      { slug: "tn-196", nameEn: "Nam Kok Building", nameZh: "南角樓", address: "196", height: 30 },
    ],
  },
  {
    id: "yu-chau",
    nameEn: "Yu Chau Street",
    nameZh: "汝州街",
    district: "Sham Shui Po",
    headingDeg: 97,
    start: [114.16182, 22.32874],
    end: [114.16528, 22.32858],
    side: -1,
    setbackM: 6.6,
    priors: {
      height: [16, 33],
      subdividedFlatDensity: [0.58, 0.92],
      elderlyRatio: [0.3, 0.58],
      povertyIndex: [0.46, 0.83],
      acAnthropogenicHeat: [50, 140],
      ventilationBlockage: [0.55, 0.9],
      baselineCVDPrevalence: [11.0, 20.6],
      widthM: [10.5, 15],
      depthM: [15, 22],
    },
    lots: [
      { slug: "yc-72", nameEn: "Yu Chau Fabric House", nameZh: "汝州布行唐樓", address: "72", height: 18, subdividedFlatDensity: 0.89 },
      { slug: "yc-88", nameEn: "Yu Chau Street Tong Lau", nameZh: "汝州街唐樓", address: "88", height: 20, elderlyRatio: 0.55 },
      { slug: "yc-104", nameEn: "Sham Shui Cloth Mansion", nameZh: "深水埗布業大樓", address: "104", height: 27, acAnthropogenicHeat: 136 },
      { slug: "yc-120", nameEn: "Wing Hang Building", nameZh: "永亨樓", address: "120", height: 24 },
      { slug: "yc-138", nameEn: "Apliu Backlane Block", nameZh: "鴨寮後巷唐樓", address: "138", height: 16, ventilationBlockage: 0.91, povertyIndex: 0.82 },
      { slug: "yc-154", nameEn: "Chau On House", nameZh: "州安樓", address: "154", height: 29 },
      { slug: "yc-170", nameEn: "Yu Chau Walk-up 170", nameZh: "汝州街170號", address: "170", height: 21, subdividedFlatDensity: 0.86 },
      { slug: "yc-186", nameEn: "Nam Shan Approach Tong Lau", nameZh: "南山邨口唐樓", address: "186", height: 23, elderlyRatio: 0.5 },
    ],
  },
  {
    id: "apliu",
    nameEn: "Apliu Street",
    nameZh: "鴨寮街",
    district: "Sham Shui Po",
    headingDeg: 98,
    start: [114.1617, 22.32984],
    end: [114.1649, 22.32968],
    side: 1,
    setbackM: 6.4,
    priors: {
      height: [15, 32],
      subdividedFlatDensity: [0.6, 0.95],
      elderlyRatio: [0.29, 0.56],
      povertyIndex: [0.5, 0.88],
      acAnthropogenicHeat: [62, 168],
      ventilationBlockage: [0.6, 0.93],
      baselineCVDPrevalence: [10.8, 20.2],
      widthM: [9.5, 14.5],
      depthM: [14, 21],
    },
    lots: [
      { slug: "ap-83", nameEn: "Apliu Electronics Tong Lau", nameZh: "鴨寮電器唐樓", address: "83", height: 18, acAnthropogenicHeat: 168, subdividedFlatDensity: 0.84 },
      { slug: "ap-99", nameEn: "Apliu Street Tong Lau", nameZh: "鴨寮街唐樓", address: "99", height: 20, ventilationBlockage: 0.89 },
      { slug: "ap-111", nameEn: "Golden Computer Block", nameZh: "黃金電腦樓", address: "111", height: 26, acAnthropogenicHeat: 174 },
      { slug: "ap-127", nameEn: "Pei Ho Crossing House", nameZh: "北河口唐樓", address: "127", height: 22, elderlyRatio: 0.49 },
      { slug: "ap-141", nameEn: "Radio Lane Mansion", nameZh: "收音機巷大樓", address: "141", height: 29, subdividedFlatDensity: 0.73 },
      { slug: "ap-155", nameEn: "Apliu Hawker Backblock", nameZh: "鴨寮排檔唐樓", address: "155", height: 15, povertyIndex: 0.85, ventilationBlockage: 0.93 },
      { slug: "ap-171", nameEn: "Kweilin Corner House", nameZh: "桂林街角樓", address: "171", height: 24 },
      { slug: "ap-187", nameEn: "Yen Chow Electronics Walk-up", nameZh: "欽州電器唐樓", address: "187", height: 21, acAnthropogenicHeat: 155 },
    ],
  },
  {
    id: "temple",
    nameEn: "Temple Street",
    nameZh: "廟街",
    district: "Yau Tsim Mong",
    headingDeg: 9,
    start: [114.17032, 22.30555],
    end: [114.17058, 22.31128],
    side: 1,
    setbackM: 6.2,
    priors: {
      height: [16, 36],
      subdividedFlatDensity: [0.52, 0.88],
      elderlyRatio: [0.26, 0.54],
      povertyIndex: [0.4, 0.78],
      acAnthropogenicHeat: [58, 150],
      ventilationBlockage: [0.62, 0.94],
      baselineCVDPrevalence: [10.0, 19.0],
      widthM: [10, 14.5],
      depthM: [15, 22],
    },
    lots: [
      { slug: "ts-88", nameEn: "Temple Street Night Market Block", nameZh: "廟街夜市唐樓", address: "88", height: 19, ventilationBlockage: 0.94, subdividedFlatDensity: 0.86 },
      { slug: "ts-102", nameEn: "Tin Hau Approach Tong Lau", nameZh: "天后廟口唐樓", address: "102", height: 21, elderlyRatio: 0.51 },
      { slug: "ts-118", nameEn: "Temple St Walk-up 118", nameZh: "廟街118號", address: "118", height: 17, povertyIndex: 0.76 },
      { slug: "ts-134", nameEn: "Yau Ma Tei Jade House", nameZh: "油麻地玉器樓", address: "134", height: 26, acAnthropogenicHeat: 142 },
      { slug: "ts-148", nameEn: "Public Square St Corner", nameZh: "眾坊街角唐樓", address: "148", height: 23, ventilationBlockage: 0.88 },
      { slug: "ts-162", nameEn: "Temple Street Mansion", nameZh: "廟街大樓", address: "162", height: 32 },
      { slug: "ts-178", nameEn: "Woosung Crossing Block", nameZh: "吳松街口唐樓", address: "178", height: 20, subdividedFlatDensity: 0.8 },
    ],
  },
  {
    id: "shanghai",
    nameEn: "Shanghai Street",
    nameZh: "上海街",
    district: "Yau Tsim Mong",
    headingDeg: 8,
    start: [114.16982, 22.30685],
    end: [114.17018, 22.31422],
    side: -1,
    setbackM: 7.2,
    priors: {
      height: [18, 48],
      subdividedFlatDensity: [0.38, 0.78],
      elderlyRatio: [0.22, 0.48],
      povertyIndex: [0.32, 0.68],
      acAnthropogenicHeat: [70, 165],
      ventilationBlockage: [0.48, 0.86],
      baselineCVDPrevalence: [9.1, 17.6],
      widthM: [11, 16],
      depthM: [16, 24],
    },
    lots: [
      { slug: "sh-168", nameEn: "Shanghai Street Tong Lau", nameZh: "上海街唐樓", address: "168", height: 22, subdividedFlatDensity: 0.74 },
      { slug: "sh-190", nameEn: "Yau Ma Tei Fruit Market Block", nameZh: "果欄唐樓", address: "190", height: 18, ventilationBlockage: 0.85, elderlyRatio: 0.46 },
      { slug: "sh-212", nameEn: "Kitchenware Walk-up", nameZh: "上海街廚具唐樓", address: "212", height: 24, acAnthropogenicHeat: 148 },
      { slug: "sh-236", nameEn: "Wing Sing Lane House", nameZh: "永星里唐樓", address: "236", height: 20, povertyIndex: 0.64 },
      { slug: "sh-258", nameEn: "Kwong Wah Approach Mansion", nameZh: "廣華醫院口大樓", address: "258", height: 36, subdividedFlatDensity: 0.44, acAnthropogenicHeat: 160 },
      { slug: "sh-280", nameEn: "Shanghai St Pre-war Block", nameZh: "上海街戰前唐樓", address: "280", height: 16, elderlyRatio: 0.48, subdividedFlatDensity: 0.78 },
      { slug: "sh-304", nameEn: "Pitt Street Corner House", nameZh: "碧街角樓", address: "304", height: 28 },
      { slug: "sh-328", nameEn: "Waterloo Crossing Tower", nameZh: "窩打老道口大樓", address: "328", height: 42, acAnthropogenicHeat: 165 },
    ],
  },
  {
    id: "nathan",
    nameEn: "Nathan Road",
    nameZh: "彌敦道",
    district: "Yau Tsim Mong",
    headingDeg: 12,
    start: [114.17152, 22.30785],
    end: [114.17188, 22.31555],
    side: 1,
    setbackM: 9.5,
    priors: {
      height: [42, 88],
      subdividedFlatDensity: [0.12, 0.42],
      elderlyRatio: [0.16, 0.34],
      povertyIndex: [0.14, 0.42],
      acAnthropogenicHeat: [110, 180],
      ventilationBlockage: [0.34, 0.62],
      baselineCVDPrevalence: [7.8, 14.5],
      widthM: [14, 22],
      depthM: [18, 28],
    },
    lots: [
      { slug: "nr-380", nameEn: "Nathan Rd Podium Tower", nameZh: "彌敦道平台大廈", address: "380", height: 72, acAnthropogenicHeat: 176 },
      { slug: "nr-412", nameEn: "Yau Ma Tei Nathan Mansion", nameZh: "油麻地彌敦大樓", address: "412", height: 58, subdividedFlatDensity: 0.28 },
      { slug: "nr-446", nameEn: "Nathan Road Commercial Walk-up", nameZh: "彌敦道商住唐樓", address: "446", height: 44, ventilationBlockage: 0.55 },
      { slug: "nr-478", nameEn: "Jordan Approach Tower", nameZh: "佐敦道口大廈", address: "478", height: 84, acAnthropogenicHeat: 180, elderlyRatio: 0.18 },
      { slug: "nr-510", nameEn: "Waterloo Nathan Block", nameZh: "窩打老彌敦樓", address: "510", height: 63 },
    ],
  },
  {
    id: "ki-lung",
    nameEn: "Ki Lung Street",
    nameZh: "基隆街",
    district: "Sham Shui Po",
    headingDeg: 97,
    start: [114.16195, 22.32816],
    end: [114.16535, 22.328],
    side: 1,
    setbackM: 6.5,
    priors: {
      height: [16, 32],
      subdividedFlatDensity: [0.56, 0.9],
      elderlyRatio: [0.28, 0.55],
      povertyIndex: [0.44, 0.8],
      acAnthropogenicHeat: [48, 138],
      ventilationBlockage: [0.52, 0.9],
      baselineCVDPrevalence: [10.4, 19.8],
      widthM: [10, 15],
      depthM: [15, 22],
    },
    lots: [
      { slug: "kl-41", nameEn: "Ki Lung Street Tong Lau", nameZh: "基隆街唐樓", address: "41", height: 18, subdividedFlatDensity: 0.88 },
      { slug: "kl-57", nameEn: "Nam Cheong Approach House", nameZh: "南昌道口唐樓", address: "57", height: 22 },
      { slug: "kl-73", nameEn: "Ki Lung Walk-up 73", nameZh: "基隆街73號", address: "73", height: 17, elderlyRatio: 0.53 },
      { slug: "kl-89", nameEn: "Fabric Lane Mansion", nameZh: "布匹巷大樓", address: "89", height: 26, acAnthropogenicHeat: 132 },
      { slug: "kl-105", nameEn: "Pei Ho Crossing Tong Lau", nameZh: "北河口唐樓", address: "105", height: 20, ventilationBlockage: 0.86 },
      { slug: "kl-121", nameEn: "Ki Lung Pre-war Block", nameZh: "基隆街戰前唐樓", address: "121", height: 16, povertyIndex: 0.78, subdividedFlatDensity: 0.91 },
      { slug: "kl-137", nameEn: "Yen Chow Fabric House", nameZh: "欽州布行樓", address: "137", height: 24 },
    ],
  },
  {
    id: "kweilin",
    nameEn: "Kweilin Street",
    nameZh: "桂林街",
    district: "Sham Shui Po",
    headingDeg: 8,
    start: [114.16405, 22.32835],
    end: [114.16432, 22.33155],
    side: -1,
    setbackM: 6.7,
    priors: {
      height: [17, 34],
      subdividedFlatDensity: [0.54, 0.88],
      elderlyRatio: [0.27, 0.54],
      povertyIndex: [0.42, 0.79],
      acAnthropogenicHeat: [50, 142],
      ventilationBlockage: [0.5, 0.88],
      baselineCVDPrevalence: [10.1, 19.4],
      widthM: [10.5, 15.5],
      depthM: [15, 23],
    },
    lots: [
      { slug: "gw-28", nameEn: "Kweilin Street Tong Lau", nameZh: "桂林街唐樓", address: "28", height: 19, subdividedFlatDensity: 0.84 },
      { slug: "gw-44", nameEn: "Apliu Crossing House", nameZh: "鴨寮街口唐樓", address: "44", height: 23, acAnthropogenicHeat: 146 },
      { slug: "gw-60", nameEn: "Kweilin Walk-up 60", nameZh: "桂林街60號", address: "60", height: 21, elderlyRatio: 0.5 },
      { slug: "gw-76", nameEn: "Fuk Wa Corner Mansion", nameZh: "福華街角大樓", address: "76", height: 29 },
      { slug: "gw-92", nameEn: "Kweilin Backlane Block", nameZh: "桂林後巷唐樓", address: "92", height: 16, ventilationBlockage: 0.9, povertyIndex: 0.8 },
      { slug: "gw-108", nameEn: "Nam Shan Approach House", nameZh: "南山邨口唐樓", address: "108", height: 25 },
    ],
  },
  {
    id: "portland",
    nameEn: "Portland Street",
    nameZh: "砵蘭街",
    district: "Yau Tsim Mong",
    headingDeg: 9,
    start: [114.16915, 22.30615],
    end: [114.16948, 22.31285],
    side: 1,
    setbackM: 6.3,
    priors: {
      height: [16, 38],
      subdividedFlatDensity: [0.5, 0.86],
      elderlyRatio: [0.24, 0.5],
      povertyIndex: [0.38, 0.74],
      acAnthropogenicHeat: [60, 155],
      ventilationBlockage: [0.58, 0.92],
      baselineCVDPrevalence: [9.6, 18.4],
      widthM: [10, 14.5],
      depthM: [15, 22],
    },
    lots: [
      { slug: "pt-88", nameEn: "Portland Street Tong Lau", nameZh: "砵蘭街唐樓", address: "88", height: 20, subdividedFlatDensity: 0.82 },
      { slug: "pt-112", nameEn: "Yau Ma Tei Night Block", nameZh: "油麻地夜唐樓", address: "112", height: 18, ventilationBlockage: 0.9 },
      { slug: "pt-136", nameEn: "Portland Walk-up 136", nameZh: "砵蘭街136號", address: "136", height: 22, elderlyRatio: 0.47 },
      { slug: "pt-160", nameEn: "Jade Market Approach House", nameZh: "玉器市場口唐樓", address: "160", height: 26, acAnthropogenicHeat: 140 },
      { slug: "pt-184", nameEn: "Portland Pre-war Block", nameZh: "砵蘭街戰前唐樓", address: "184", height: 16, povertyIndex: 0.7, subdividedFlatDensity: 0.85 },
      { slug: "pt-208", nameEn: "Public Square Crossing", nameZh: "眾坊街口唐樓", address: "208", height: 24 },
      { slug: "pt-232", nameEn: "Portland Mansion", nameZh: "砵蘭街大樓", address: "232", height: 34 },
    ],
  },
  {
    id: "reclamation",
    nameEn: "Reclamation Street",
    nameZh: "新填地街",
    district: "Yau Tsim Mong",
    headingDeg: 9,
    start: [114.16995, 22.3064],
    end: [114.17028, 22.3132],
    side: -1,
    setbackM: 6.4,
    priors: {
      height: [17, 36],
      subdividedFlatDensity: [0.46, 0.82],
      elderlyRatio: [0.23, 0.48],
      povertyIndex: [0.36, 0.7],
      acAnthropogenicHeat: [58, 148],
      ventilationBlockage: [0.5, 0.86],
      baselineCVDPrevalence: [9.3, 17.8],
      widthM: [10.5, 15],
      depthM: [16, 23],
    },
    lots: [
      { slug: "rc-96", nameEn: "Reclamation Street Tong Lau", nameZh: "新填地街唐樓", address: "96", height: 21, subdividedFlatDensity: 0.76 },
      { slug: "rc-122", nameEn: "Fruit Market Backblock", nameZh: "果欄後座唐樓", address: "122", height: 18, ventilationBlockage: 0.84, elderlyRatio: 0.45 },
      { slug: "rc-148", nameEn: "Reclamation Walk-up 148", nameZh: "新填地街148號", address: "148", height: 23 },
      { slug: "rc-174", nameEn: "Shanghai Crossing House", nameZh: "上海街口唐樓", address: "174", height: 27, acAnthropogenicHeat: 138 },
      { slug: "rc-200", nameEn: "Reclamation Pre-war Block", nameZh: "新填地街戰前唐樓", address: "200", height: 16, povertyIndex: 0.66 },
      { slug: "rc-226", nameEn: "Kwong Wah Approach Tong Lau", nameZh: "廣華醫院口唐樓", address: "226", height: 32 },
    ],
  },
];

function lerpRange(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

function footprintPolygon(
  lng: number,
  lat: number,
  widthM: number,
  depthM: number,
  headingDeg: number,
): LonLat[] {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(lat);
  const rad = (headingDeg * Math.PI) / 180;
  const cosH = Math.cos(rad);
  const sinH = Math.sin(rad);
  const hw = widthM / 2;
  const hd = depthM / 2;
  const local: LonLat[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
    [-hw, -hd],
  ];
  return local.map(([x, y]) => {
    const east = x * cosH - y * sinH;
    const north = x * sinH + y * cosH;
    return [lng + east / metersPerDegLng, lat + north / metersPerDegLat];
  });
}

function interpolateLonLat(start: LonLat, end: LonLat, t: number): LonLat {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function offsetPerpendicular(
  lng: number,
  lat: number,
  headingDeg: number,
  meters: number,
): LonLat {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(lat);
  const rad = ((headingDeg + 90) * Math.PI) / 180;
  return [lng + (Math.sin(rad) * meters) / metersPerDegLng, lat + (Math.cos(rad) * meters) / metersPerDegLat];
}

function buildFeature(street: StreetBlueprint, lot: LotOverride, index: number, total: number): BuildingFeature {
  const t = (index + 0.5) / total;
  const rng = mulberry32(hashString(`${street.id}:${lot.slug}`));
  const along = interpolateLonLat(street.start, street.end, t);
  const centroid = offsetPerpendicular(along[0], along[1], street.headingDeg, street.side * street.setbackM);
  assertWgs84(centroid[0], centroid[1]);

  const pick = (range: [number, number], override: number | undefined): number => {
    if (typeof override === "number") return override;
    return lerpRange(range, 0.12 + rng() * 0.76);
  };

  const widthM = pick(street.priors.widthM, lot.widthM);
  const depthM = pick(street.priors.depthM, lot.depthM);
  const height = pick(street.priors.height, lot.height);
  const subdividedFlatDensity = pick(street.priors.subdividedFlatDensity, lot.subdividedFlatDensity);
  const elderlyRatio = pick(street.priors.elderlyRatio, lot.elderlyRatio);
  const povertyIndex = pick(street.priors.povertyIndex, lot.povertyIndex);
  const acAnthropogenicHeat = pick(street.priors.acAnthropogenicHeat, lot.acAnthropogenicHeat);
  const ventilationBlockage = pick(street.priors.ventilationBlockage, lot.ventilationBlockage);
  const baselineCVDPrevalence = pick(street.priors.baselineCVDPrevalence, lot.baselineCVDPrevalence);

  const floors = Math.max(4, Math.round(height / 3.15));
  const units = Math.max(
    8,
    Math.round((widthM * depthM) / 22 * floors * (0.55 + 1.35 * subdividedFlatDensity)),
  );
  const estimatedResidents = Math.round(units * (1.55 + 1.25 * subdividedFlatDensity));
  const hk80 = wgs84ToHk80(centroid[0], centroid[1]);
  const ring = footprintPolygon(centroid[0], centroid[1], widthM, depthM, street.headingDeg);

  const properties: BuildingProperties = {
    id: `${street.id}-${lot.slug}`,
    nameEn: `${lot.nameEn} / ${street.nameEn} ${lot.address}`,
    nameZh: `${lot.nameZh}／${street.nameZh}${lot.address}號`,
    address: `${lot.address} ${street.nameEn}`,
    streetEn: street.nameEn,
    streetZh: street.nameZh,
    district: street.district,
    height: roundTo(height, 1),
    subdividedFlatDensity: roundTo(subdividedFlatDensity, 3),
    elderlyRatio: roundTo(elderlyRatio, 3),
    povertyIndex: roundTo(povertyIndex, 3),
    acAnthropogenicHeat: roundTo(acAnthropogenicHeat, 1),
    ventilationBlockage: roundTo(ventilationBlockage, 3),
    baselineCVDPrevalence: roundTo(baselineCVDPrevalence, 2),
    estimatedResidents,
    headingDeg: street.headingDeg,
    hk80: { easting: roundTo(hk80.easting, 2), northing: roundTo(hk80.northing, 2) },
    roofAreaM2: roundTo(wgs84RingAreaM2(ring), 2),
  };

  return {
    type: "Feature",
    id: properties.id,
    geometry: { type: "Polygon", coordinates: [ring] },
    properties,
  };
}

let cachedCollection: BuildingFeatureCollection | null = null;

export function getBuildingCollection(): BuildingFeatureCollection {
  if (cachedCollection) return cachedCollection;
  const features: BuildingFeature[] = [];
  for (const street of STREETS) {
    street.lots.forEach((lot, index) => {
      features.push(buildFeature(street, lot, index, street.lots.length));
    });
  }
  if (features.length < 50) {
    throw new Error(`Spatial twin requires ≥50 buildings, generated ${features.length}`);
  }
  cachedCollection = {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:4326" } },
    features,
  };
  return cachedCollection;
}

export function getBuildings(): BuildingFeature[] {
  return getBuildingCollection().features;
}

export function getBuildingById(id: string): BuildingFeature {
  const found = getBuildings().find((b) => b.properties.id === id);
  if (!found) {
    throw new Error(`Unknown building id ${id}`);
  }
  return found;
}

export function buildingCentroid(feature: BuildingFeature): LonLat {
  const ring = feature.geometry.coordinates[0];
  const n = Math.max(1, ring.length - 1);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
