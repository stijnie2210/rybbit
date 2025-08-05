import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../../../components/ui/basic-tabs";
import {
  Card,
  CardContent,
  CardLoader,
} from "../../../../../components/ui/card";
import { useGetOutboundLinks } from "../../../../../api/analytics/events/useGetOutboundLinks";
import { OutboundLinksList } from "../../../events/components/OutboundLinksList";

type Tab = "outbound";

export function OutboundLinks() {
  const [tab, setTab] = useState<Tab>("outbound");
  const { data: outboundLinksData, isLoading: isLoadingOutboundLinks } =
    useGetOutboundLinks();

  return (
    <Card>
      <CardContent className="mt-2">
        <Tabs
          defaultValue="outbound"
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
        >
          <TabsList>
            <TabsTrigger value="outbound">Outbound Clicks</TabsTrigger>
          </TabsList>
          <TabsContent value="outbound">
            {isLoadingOutboundLinks && (
              <div className="absolute top-[-8px] left-0 w-full h-full">
                <CardLoader />
              </div>
            )}
            <div className="relative">
              <div className="flex flex-row gap-2 justify-between pr-1 text-xs text-neutral-400 mb-2">
                <div>External Links</div>
                <div>Clicks</div>
              </div>
              <OutboundLinksList
                outboundLinks={outboundLinksData || []}
                isLoading={isLoadingOutboundLinks}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}