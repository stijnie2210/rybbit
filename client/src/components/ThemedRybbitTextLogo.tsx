import { useEffect, useState } from "react";
import Image from "next/image";

// Returns 'dark' or 'light' based on class on <html>
function useTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function ThemedRybbitTextLogo(props: Omit<React.ComponentProps<typeof Image>, "src">) {
  const theme = useTheme();
  return (
    <Image
      src={theme === "dark" ? "/rybbit-text.svg" : "/rybbit-text-black.svg"}
      {...props}
    />
  );
}
