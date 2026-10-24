import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import {
	basicAdjustDefinition,
	filterEffectDefinitions,
} from "./color";
import { geometryEffectDefinitions } from "./geometry";
import {
	composedEffectDefinitions,
	glowEffectDefinition,
	sharpenEffectDefinition,
	skinSmoothEffectDefinition,
} from "./light";

const defaultEffects = [
	blurEffectDefinition,
	basicAdjustDefinition,
	glowEffectDefinition,
	sharpenEffectDefinition,
	skinSmoothEffectDefinition,
	...composedEffectDefinitions,
	...geometryEffectDefinitions,
	...filterEffectDefinitions,
];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
