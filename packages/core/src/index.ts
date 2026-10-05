export * from './types';
export * from './docx';
export * from './rules';
export * from './format';
export * from './validate';
export * from './render';
export * from './sign';
export { blockUnits, coveredRange, isInTable } from './blocks';
export { listParagraphs, paragraphText } from './model';
export {
  applyDefinition,
  generateDocx,
  previewDocx,
  MissingAnswersError,
  TemplateDriftError,
  type GenerateOptions,
  type SignatureTag,
} from './generate';
export type { ParaProps, RunProps } from './styles';
export { findText, blockRange } from './locate';
export { sampleDefinition, sampleAnswers } from './sample';
