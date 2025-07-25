"use client";

import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { useSetPageTitle } from "../../../hooks/useSetPageTitle";
import { cn } from "../../../lib/utils";
import { MapComponent } from "../components/shared/Map";
import { SubHeader } from "../components/SubHeader/SubHeader";
import { DisabledOverlay } from "../../../components/DisabledOverlay";

export default function MapPage() {
  useSetPageTitle("Rybbit · Map");

  const [mapMode, setMapMode] = useState<"total" | "perCapita">("total");

  return (
    <DisabledOverlay message="Map" featurePath="map">
      <div className="relative w-full h-[calc(100vh-45px)]">
        <div className="p-2 md:p-4 relative z-50">
          <SubHeader />
        </div>
        <div className="absolute bottom-2 md:bottom-4 left-2 md:left-4 z-50">
          <div className="flex items-center gap-3 bg-neutral-900 rounded-md px-3 py-2 text-sm">
            <span className={cn(mapMode === "total" ? "text-white" : "text-neutral-400")}>Total Visits</span>
            <Switch
              checked={mapMode === "perCapita"}
              onCheckedChange={(checked) => setMapMode(checked ? "perCapita" : "total")}
              className="data-[state=checked]:bg-accent-400"
            />
            <span className={cn(mapMode === "perCapita" ? "text-white" : "text-neutral-400")}>Per Capita</span>
          </div>
        </div>
        <div className="absolute top-0 left-0 right-0 bottom-0 z-10">
          <MapComponent height="calc(100vh - 45px - 40px)" mode={mapMode} />
        </div>
      </div>
    </DisabledOverlay>
  );
}
