"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";

const ForgePanel = dynamic(() => import("../../components/ForgePanel"), { ssr: false });

/**
 * /forge — the sprite generation panel: ComfyUI backend status, model
 * manager (download / swap the pipeline's weights) and rotate/animate/edit
 * from one init frame. Dev-box tool; same local-network gate as /admin.
 */
export default function ForgePage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const host = window.location.hostname;
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.0.0.") ||
      host === "::1";
    setAllowed(isLocal);
  }, []);

  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0a0a0f",
          color: "#555",
          fontFamily: "monospace",
        }}
      >
        forge is a local tool
      </div>
    );
  }
  return <ForgePanel />;
}
