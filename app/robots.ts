import type { MetadataRoute } from "next";

export default function robots():MetadataRoute.Robots{return{rules:{userAgent:"*",allow:"/",disallow:["/api/","/reset-password"]},sitemap:"https://hse-radar-mvp.vercel.app/sitemap.xml"}}
