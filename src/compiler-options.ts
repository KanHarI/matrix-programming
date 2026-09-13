import type { CompileOptions } from './core/types';

export const optimizationDefinitions = [
  { key: 'countdown', label: 'Countdown recurrence', description: 'Fuse a constant-stride countdown and remainder test into a clock-free recurrence.', defaultEnabled: true },
  { key: 'straightLine', label: 'Feed-forward expressions', description: 'Use aligned expression circuits for straight-line programs instead of an instruction machine.', defaultEnabled: true },
  { key: 'counterMachine', label: 'Clock-free counter machine', description: 'Use control pulses for eligible literal-update and comparison programs. No shared clock or ALU.', defaultEnabled: true },
  { key: 'counterFacts', label: 'Counter path facts', description: 'Prove values and operand ordering along counter control-flow paths to remove redundant resets and comparisons. Requires clock-free counter lowering.', defaultEnabled: true },
  { key: 'counterFusion', label: 'Counter block fusion', description: 'Share a control pulse across independent counter updates and thread terminal actions. Requires clock-free counter lowering.', defaultEnabled: true },
  { key: 'entryElision', label: 'Remove function entry scaffolding', description: 'Calls and main start at the first real instruction rather than a no-op entry.', defaultEnabled: true },
  { key: 'deadCode', label: 'Remove unreachable instructions', description: 'Omit instructions after unconditional termination and unreachable control-flow blocks.', defaultEnabled: true },
  { key: 'jumpThreading', label: 'Thread jumps', description: 'Route control straight through chains of no-op jumps.', defaultEnabled: true },
  { key: 'copyCoalescing', label: 'Coalesce expression copies', description: 'Write single-use expression results directly into their destinations.', defaultEnabled: true },
  { key: 'scratchReuse', label: 'Reuse scratch coordinates', description: 'Use CFG liveness to share temporary registers that are never live together.', defaultEnabled: true },
  { key: 'directDelta', label: 'Direct literal updates', description: 'Apply in-place constant increments and decrements directly to retained rows.', defaultEnabled: true },
  { key: 'constantWrites', label: 'Specialize constant assignments', description: 'Avoid the new-value ALU transfer when every replacement writer is constant.', defaultEnabled: true },
  { key: 'constantReturns', label: 'Fuse constant main returns', description: 'Write a small constant result and the end gate on the same update.', defaultEnabled: true },
  { key: 'comparisonFusion', label: 'Fuse comparison branches', description: 'Feed comparisons into control without materializing a Boolean through the ALU.', defaultEnabled: true },
  { key: 'predicateSharing', label: 'Share comparison predicates', description: 'Reuse identical difference and equality circuits in the clocked backend.', defaultEnabled: true },
  { key: 'constantOperands', label: 'Specialize constant operands', description: 'Scale an instruction selector instead of selecting an immutable constant word.', defaultEnabled: true },
  { key: 'boundedGates', label: 'Use bounded selection gates', description: 'Use a shorter subtraction gate when a word has a proven small bound.', defaultEnabled: true },
  { key: 'sharedGateDelays', label: 'Share selector delays', description: 'Share timing coordinates between full-u32 gates with the same selector.', defaultEnabled: true },
  { key: 'clockSampling', label: 'Sample clock phases directly', description: 'Use the common clock phases instead of per-instruction delay pipelines.', defaultEnabled: true },
  { key: 'prune', label: 'Prune unused matrix coordinates', description: 'Remove rows outside observable dependencies, preserving possible checked faults.', defaultEnabled: true },
  { key: 'loopSummaries', label: 'Summarize pure countdown loops', description: 'Replace decrement-to-zero loops with equivalent assignments. Changes traces; may increase matrix size or runtime when it prevents a compact lowering.', defaultEnabled: false },
] as const;

export type OptimizationKey = typeof optimizationDefinitions[number]['key'];
export type OptimizationFlags = Record<OptimizationKey, boolean>;

export function resolveOptimizations(options: CompileOptions = {}): OptimizationFlags {
  if (options.optimizations !== undefined && (!options.optimizations || typeof options.optimizations !== 'object' || Array.isArray(options.optimizations))) {
    throw new Error('optimizations must be an object of Boolean compiler flags');
  }
  const flags = Object.fromEntries(optimizationDefinitions.map(flag => [flag.key, flag.defaultEnabled])) as OptimizationFlags;
  // Preserve the original API; the new explicit flag wins if both are supplied.
  if (options.summarizeLoops !== undefined) {
    if (typeof options.summarizeLoops !== 'boolean') throw new Error('summarizeLoops must be a boolean');
    flags.loopSummaries = options.summarizeLoops;
  }
  for (const [key, value] of Object.entries(options.optimizations ?? {})) {
    if (!optimizationDefinitions.some(flag => flag.key === key)) throw new Error(`Unknown compiler optimization '${key}'`);
    if (typeof value !== 'boolean') throw new Error(`Compiler optimization '${key}' must be a boolean`);
    flags[key as OptimizationKey] = value;
  }
  return flags;
}
