import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface ExcludedIPsResponse {
  success: boolean;
  excludedIPs: string[];
  error?: string;
}

export interface UpdateExcludedIPsRequest {
  siteId: string;
  excludedIPs: string[];
}

export interface UpdateExcludedIPsResponse {
  success: boolean;
  message: string;
  excludedIPs: string[];
  error?: string;
  details?: string[];
}

// Fetch excluded IPs for a site
export const fetchExcludedIPs = async (siteId: number): Promise<ExcludedIPsResponse> => {
  const response = await fetch(`/api/site/${siteId}/excluded-ips`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch excluded IPs");
  }

  return response.json();
};

// Update excluded IPs for a site
export const updateExcludedIPs = async (
  siteId: number,
  excludedIPs: string[]
): Promise<UpdateExcludedIPsResponse> => {
  const response = await fetch(`/api/site/${siteId}/excluded-ips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      siteId: siteId.toString(),
      excludedIPs,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to update excluded IPs");
  }

  return data;
};

// Hook to fetch excluded IPs
export const useGetExcludedIPs = (siteId: number) => {
  return useQuery({
    queryKey: ["excludedIPs", siteId],
    queryFn: () => fetchExcludedIPs(siteId),
    enabled: !!siteId,
  });
};

// Hook to update excluded IPs
export const useUpdateExcludedIPs = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, excludedIPs }: { siteId: number; excludedIPs: string[] }) =>
      updateExcludedIPs(siteId, excludedIPs),
    onSuccess: (data, variables) => {
      toast.success("Excluded IPs updated successfully");
      // Invalidate and refetch excluded IPs data
      queryClient.invalidateQueries({
        queryKey: ["excludedIPs", variables.siteId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update excluded IPs");
    },
  });
};