   //app/solutions/page.tsx
   import type { Metadata } from "next"
   import { SolutionsClient } from "./solutions-client"

   export const metadata: Metadata = {
     title: "Custom Solutions & API Access | Mediacrater",
     description: "API access, higher volume and custom compliance pipelines for agencies, platforms and high-volume ad teams.",
     alternates: { canonical: "/solutions" },
   }

   export default function SolutionsPage() {
     return <SolutionsClient />
   }
