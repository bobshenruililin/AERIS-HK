import { LayerExtension } from "@deck.gl/core";
import type { CompositeLayer, Layer } from "@deck.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

export type VenturiStreamExtensionProps = {
  /** Seconds, drives the GPU streak pulse along alley streamlines. */
  venturiTime?: number;
};

type VenturiModuleProps = { time: number };

const venturiModule: ShaderModule<VenturiModuleProps> = {
  name: "venturiStream",
  vs: `\
uniform venturiStreamUniforms {
  float time;
} venturiStream;
`,
  fs: `\
uniform venturiStreamUniforms {
  float time;
} venturiStream;
`,
  uniformTypes: {
    time: "f32",
  },
};

const inject = {
  "vs:DECKGL_FILTER_GL_POSITION": `\
  float streak = 0.006 * sin(geometry.worldPosition.x * 55.0 + geometry.worldPosition.y * 40.0 + venturiStream.time * 9.0);
  gl_Position.xy += vec2(streak, streak * 0.35);
`,
  "fs:DECKGL_FILTER_COLOR": `\
  float pulse = 0.5 + 0.5 * sin(geometry.worldPosition.x * 42.0 + venturiStream.time * 8.0);
  color.rgb = mix(color.rgb, vec3(1.0, 0.78, 0.22), 0.28 * pulse);
  color.a = min(1.0, color.a * (0.75 + 0.35 * pulse));
`,
};

/**
 * Deck.gl v9 PathLayer extension: Venturi alley streaks shimmer on the GPU
 * without rebuilding GeoJSON every animation frame.
 */
export class VenturiStreamExtension extends LayerExtension {
  static defaultProps = {
    venturiTime: { type: "number", value: 0 },
  };
  static extensionName = "VenturiStreamExtension";

  getShaders(): { modules: ShaderModule<VenturiModuleProps>[]; inject: typeof inject } {
    return { modules: [venturiModule], inject };
  }

  draw(this: Layer<Required<VenturiStreamExtensionProps>>): void {
    this.setShaderModuleProps({
      venturiStream: { time: this.props.venturiTime ?? 0 },
    });
  }

  getSubLayerProps(this: CompositeLayer<VenturiStreamExtensionProps>): { venturiTime: number } {
    return { venturiTime: this.props.venturiTime ?? 0 };
  }
}
