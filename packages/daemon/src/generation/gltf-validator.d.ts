declare module "gltf-validator" {
  const validator: {
    validateBytes(
      data: Uint8Array,
      options?: { uri?: string },
    ): Promise<{ issues: { numErrors: number; numWarnings: number } }>;
  };
  export default validator;
}
