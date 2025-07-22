import Image from "next/image";
import { useTheme } from "@/hooks/useTheme";

export function ThemedRybbitLogo(props: Omit<React.ComponentProps<typeof Image>, "src">) {
  const theme = useTheme();
  return (
    <Image
      src={theme === "dark" ? "/rybbit.svg" : "/rybbit-black.svg"}
      {...props}
    />
  );
}
