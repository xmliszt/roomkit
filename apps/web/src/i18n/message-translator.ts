export type MessageTranslator = (
  key: string,
  values?: { [name: string]: string | number },
) => string;
