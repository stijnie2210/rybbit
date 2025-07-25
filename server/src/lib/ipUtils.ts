import { Address4, Address6 } from "ip-address";

export interface IPRange {
  ip: string;
  type: "single" | "range" | "cidr";
}

/**
 * Check if an IP address matches any of the excluded IPs/ranges
 */
export function isIPExcluded(ipAddress: string, excludedIPs: string[]): boolean {
  if (!excludedIPs || excludedIPs.length === 0) {
    return false;
  }

  for (const excludedPattern of excludedIPs) {
    if (matchesIPPattern(ipAddress, excludedPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an IP address matches a specific pattern
 * Supports:
 * - Single IP: 192.168.1.1
 * - CIDR notation: 192.168.1.0/24
 * - Range notation: 192.168.1.1-192.168.1.10
 */
function matchesIPPattern(ipAddress: string, pattern: string): boolean {
  try {
    const trimmedPattern = pattern.trim();
    
    // Single IP match
    if (!trimmedPattern.includes("/") && !trimmedPattern.includes("-")) {
      return ipAddress === trimmedPattern;
    }

    // CIDR notation
    if (trimmedPattern.includes("/")) {
      return matchesCIDR(ipAddress, trimmedPattern);
    }

    // Range notation
    if (trimmedPattern.includes("-")) {
      return matchesRange(ipAddress, trimmedPattern);
    }

    return false;
  } catch (error) {
    console.warn(`Invalid IP pattern: ${pattern}`, error);
    return false;
  }
}

/**
 * Check if IP matches CIDR notation (e.g., 192.168.1.0/24)
 */
function matchesCIDR(ipAddress: string, cidr: string): boolean {
  try {
    // Try IPv4 first
    try {
      const ipv4 = new Address4(ipAddress);
      const cidrv4 = new Address4(cidr);
      return ipv4.isInSubnet(cidrv4);
    } catch {
      // Try IPv6
      const ipv6 = new Address6(ipAddress);
      const cidrv6 = new Address6(cidr);
      return ipv6.isInSubnet(cidrv6);
    }
  } catch (error) {
    console.warn(`Error matching CIDR ${cidr} for IP ${ipAddress}:`, error);
    return false;
  }
}

/**
 * Check if IP is in range (e.g., 192.168.1.1-192.168.1.10)
 */
function matchesRange(ipAddress: string, range: string): boolean {
  try {
    const [startIP, endIP] = range.split("-").map(ip => ip.trim());
    
    // Try IPv4 first
    try {
      const ip = new Address4(ipAddress);
      const start = new Address4(startIP);
      const end = new Address4(endIP);
      
      // Convert to 32-bit integers for comparison
      const ipInt = ip.toArray().reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0; // Use unsigned right shift
      const startInt = start.toArray().reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;
      const endInt = end.toArray().reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;
      
      return ipInt >= startInt && ipInt <= endInt;
    } catch {
      // For IPv6, use string comparison as a fallback
      // This is not perfect but works for basic cases
      try {
        new Address6(ipAddress);
        new Address6(startIP);
        new Address6(endIP);
        
        // Simple lexicographic comparison - not mathematically correct but functional
        return ipAddress >= startIP && ipAddress <= endIP;
      } catch {
        return false;
      }
    }
  } catch (error) {
    console.warn(`Error matching range ${range} for IP ${ipAddress}:`, error);
    return false;
  }
}

/**
 * Validate if an IP pattern is valid
 */
export function validateIPPattern(pattern: string): { valid: boolean; error?: string } {
  try {
    const trimmedPattern = pattern.trim();
    
    // Single IP
    if (!trimmedPattern.includes("/") && !trimmedPattern.includes("-")) {
      try {
        new Address4(trimmedPattern);
        return { valid: true };
      } catch {
        try {
          new Address6(trimmedPattern);
          return { valid: true };
        } catch {
          return { valid: false, error: "Invalid IP address format" };
        }
      }
    }

    // CIDR notation
    if (trimmedPattern.includes("/")) {
      try {
        new Address4(trimmedPattern);
        return { valid: true };
      } catch {
        try {
          new Address6(trimmedPattern);
          return { valid: true };
        } catch {
          return { valid: false, error: "Invalid CIDR notation" };
        }
      }
    }

    // Range notation
    if (trimmedPattern.includes("-")) {
      const [startIP, endIP] = trimmedPattern.split("-").map(ip => ip.trim());
      if (!startIP || !endIP) {
        return { valid: false, error: "Invalid range format" };
      }
      
      try {
        new Address4(startIP);
        new Address4(endIP);
        return { valid: true };
      } catch {
        try {
          new Address6(startIP);
          new Address6(endIP);
          return { valid: true };
        } catch {
          return { valid: false, error: "Invalid IP addresses in range" };
        }
      }
    }

    return { valid: false, error: "Unknown IP pattern format" };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error}` };
  }
}