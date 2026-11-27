"use client";

import { useEffect, useRef, useState } from "react";
import type { AttachedPhoto } from "./attached-photo.ts";
import { maxAttachedPhotos } from "./max-attached-photos.ts";

/** Hold attached image files with object URLs for their thumbnails, up to `maxAttachedPhotos`. */
export function useAttachedPhotos() {
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const photosRef = useRef(photos);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.url);
      }
    };
  }, []);

  function addFiles(files: File[]) {
    const images = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, maxAttachedPhotos - photosRef.current.length));
    if (images.length === 0) {
      return;
    }
    const added = images.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos((current) => [...current, ...added]);
  }

  function removePhoto(id: string) {
    const photo = photosRef.current.find((entry) => entry.id === id);
    if (photo !== undefined) {
      URL.revokeObjectURL(photo.url);
    }
    setPhotos((current) => current.filter((entry) => entry.id !== id));
  }

  return { photos, addFiles, removePhoto };
}
