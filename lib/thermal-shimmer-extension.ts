import { LayerExtension } from "@deck.gl/core";
import type { CompositeLayer, Layer } from "@deck.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

export type ThermalShimmerExtensionProps = {
  /** 0–2 AC-rejector pulse driving GPU thermal shimmer. */
  acPulse?: number;
  getAcWatts?: (d: { properties?: { id?: string } }) => number;
};

type ThermalModuleProps = { pulse: number };

const thermalModule: ShaderModule<ThermalModuleProps> = {
  name: "thermalShimmer",
  vs: `\
uniform thermalShimmerUniforms {
  float pulse;
} thermalShimmer;
`,
  fs: `\
uniform thermalShimmerUniforms {
  float pulse;
} thermalShimmer;
`,
  uniformTypes: {
    pulse: "f32",
  },
};

const inject = {
  "vs:#decl": `\
in float instanceAcWatts;
out float vAcWatts;
`,
  "vs:DECKGL_FILTER_GL_POSITION": `\
  vAcWatts = instanceAcWatts;
  float shimmer = 0.012 * thermalShimmer.pulse * (0.35 + 0.65 * clamp(instanceAcWatts / 180.0, 0.0, 2.0));
  gl_Position.y += shimmer * sin(geometry.worldPosition.z * 0.11 + instanceAcWatts * 0.02);
`,
  "fs:#decl": `\
in float vAcWatts;
`,
  "fs:DECKGL_FILTER_COLOR": `\
  float glow = thermalShimmer.pulse * (0.22 + 0.55 * clamp(vAcWatts / 160.0, 0.0, 1.4));
  color.rgb = mix(color.rgb, vec3(1.0, 0.42, 0.08), clamp(glow, 0.0, 0.45));
  color.a = min(1.0, color.a + 0.08 * glow);
`,
};

/**
 * Deck.gl v9 LayerExtension: pulse extruded buildings with AC rejector intensity
 * on the GPU instead of rebuilding GeoJSON every animation frame.
 */
export class ThermalShimmerExtension extends LayerExtension {
  static defaultProps = {
    acPulse: { type: "number", value: 0, min: 0, max: 2 },
    getAcWatts: { type: "accessor", value: 80 },
  };
  static extensionName = "ThermalShimmerExtension";

  getShaders(): { modules: ShaderModule<ThermalModuleProps>[]; inject: typeof inject } {
    return { modules: [thermalModule], inject };
  }

  initializeState(this: Layer<ThermalShimmerExtensionProps>): void {
    const attributeManager = this.getAttributeManager();
    if (!attributeManager) return;
    attributeManager.addInstanced({
      instanceAcWatts: {
        size: 1,
        accessor: "getAcWatts",
        defaultValue: 80,
      },
    });
  }

  draw(this: Layer<Required<ThermalShimmerExtensionProps>>): void {
    this.setShaderModuleProps({
      thermalShimmer: { pulse: this.props.acPulse ?? 0 },
    });
  }

  getSubLayerProps(this: CompositeLayer<ThermalShimmerExtensionProps>): {
    acPulse: number;
    getAcWatts: ThermalShimmerExtensionProps["getAcWatts"];
  } {
    return {
      acPulse: this.props.acPulse ?? 0,
      getAcWatts: this.props.getAcWatts,
    };
  }
}
