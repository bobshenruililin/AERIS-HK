/**
 * CityJSON 2.0 encoding of Kowloon West footprints.
 * Vertices live in HK80 metres (EPSG:2326); the transform translate is the
 * first building's easting/northing so values stay small. This is the
 * CityGML/CityJSON interchange shape — not a render path (Deck.gl stays WGS84).
 */
import type { BuildingFeature } from "./types";
import { wgs84ToHk80 } from "./crs";

export interface CityJsonTransform {
  scale: [number, number, number];
  translate: [number, number, number];
}

export interface CityJsonBuilding {
  type: "Building";
  attributes: {
    nameEn: string;
    nameZh: string;
    district: string;
    height_m: number;
    storeys: number;
    roof_m2: number;
    typology: "tong-lau" | "composite";
    streetEn: string;
  };
  geometry: Array<{
    type: "Solid";
    lod: "2";
    boundaries: number[][][][];
  }>;
}

export interface CityJsonDocument {
  type: "CityJSON";
  version: "2.0";
  metadata: {
    geographicalExtent: [number, number, number, number, number, number];
    referenceSystem: "urn:ogc:def:crs:EPSG::2326";
    title: string;
  };
  transform: CityJsonTransform;
  CityObjects: Record<string, CityJsonBuilding>;
  vertices: Array<[number, number, number]>;
}

function storeysFromHeight(heightM: number): number {
  return Math.max(1, Math.round(heightM / 3.2));
}

export function buildingsToCityJson(buildings: BuildingFeature[]): CityJsonDocument {
  const vertices: Array<[number, number, number]> = [];
  const CityObjects: Record<string, CityJsonBuilding> = {};
  let minE = Infinity;
  let minN = Infinity;
  const minZ = 0;
  let maxE = -Infinity;
  let maxN = -Infinity;
  let maxZ = 0;
  const origin = buildings[0]
    ? wgs84ToHk80(buildings[0].geometry.coordinates[0][0][0], buildings[0].geometry.coordinates[0][0][1])
    : { easting: 0, northing: 0 };

  for (const feature of buildings) {
    const ring = feature.geometry.coordinates[0];
    const n = Math.max(1, ring.length - 1);
    const groundIdx: number[] = [];
    const roofIdx: number[] = [];
    const h = feature.properties.height;
    for (let i = 0; i < n; i += 1) {
      const hk = wgs84ToHk80(ring[i][0], ring[i][1]);
      const gx = hk.easting - origin.easting;
      const gy = hk.northing - origin.northing;
      groundIdx.push(vertices.length);
      vertices.push([gx, gy, 0]);
      roofIdx.push(vertices.length);
      vertices.push([gx, gy, h]);
      minE = Math.min(minE, hk.easting);
      minN = Math.min(minN, hk.northing);
      maxE = Math.max(maxE, hk.easting);
      maxN = Math.max(maxN, hk.northing);
      maxZ = Math.max(maxZ, h);
    }
    const walls: number[][][] = [];
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      walls.push([[groundIdx[i], groundIdx[j], roofIdx[j], roofIdx[i]]]);
    }
    const shell: number[][][] = [[[...groundIdx]], [[...roofIdx].reverse()], ...walls];
    CityObjects[feature.properties.id] = {
      type: "Building",
      attributes: {
        nameEn: feature.properties.nameEn,
        nameZh: feature.properties.nameZh,
        district: feature.properties.district,
        height_m: feature.properties.height,
        storeys: storeysFromHeight(feature.properties.height),
        roof_m2: feature.properties.roofAreaM2,
        typology: feature.properties.subdividedFlatDensity > 0.45 ? "tong-lau" : "composite",
        streetEn: feature.properties.streetEn,
      },
      geometry: [{ type: "Solid", lod: "2", boundaries: [shell] }],
    };
  }

  return {
    type: "CityJSON",
    version: "2.0",
    metadata: {
      geographicalExtent: [
        Number.isFinite(minE) ? minE : 0,
        Number.isFinite(minN) ? minN : 0,
        minZ,
        Number.isFinite(maxE) ? maxE : 0,
        Number.isFinite(maxN) ? maxN : 0,
        maxZ,
      ],
      referenceSystem: "urn:ogc:def:crs:EPSG::2326",
      title: "AERIS-HK Kowloon West CityJSON",
    },
    transform: {
      scale: [1, 1, 1],
      translate: [origin.easting, origin.northing, 0],
    },
    CityObjects,
    vertices,
  };
}
