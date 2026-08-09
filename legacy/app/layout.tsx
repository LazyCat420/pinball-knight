import React from "react";
import "./globals.css";

export const metadata = {
  title: "LazyCat — Jungle Room",
  description: "An interactive jungle room experience — click objects to explore.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-2X5YN9CLLR"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-2X5YN9CLLR');
            `,
          }}
        />

        {/* Mobile viewport — prevent pinch zoom on 3D canvas */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />

        {/* Security headers */}
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />

        {/* Fonts — primary fonts loaded eagerly, Hieroglyphs loaded lazily (intro-only) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Hieroglyphs font — lazy loaded (only needed during DOS boot intro) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if(window.requestIdleCallback){
                requestIdleCallback(function(){
                  var l=document.createElement('link');l.rel='stylesheet';
                  l.href='https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap';
                  document.head.appendChild(l);
                });
              } else {
                setTimeout(function(){
                  var l=document.createElement('link');l.rel='stylesheet';
                  l.href='https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap';
                  document.head.appendChild(l);
                },100);
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
