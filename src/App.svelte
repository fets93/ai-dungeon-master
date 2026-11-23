<script lang="ts">
  import Hub from "./views/Hub.svelte";
  import Screen from "./views/Screen.svelte";
  import Phone from "./views/Phone.svelte";

  // Hash routes: #/  ·  #/screen/CODE (main screen)  ·  #/play/CODE (phone)
  let hash = $state(location.hash);
  $effect(() => {
    const on = () => (hash = location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  });
  const route = $derived.by(() => {
    const [, view, code] = hash.replace(/^#/, "").split("/");
    return { view: view ?? "", code: (code ?? "").toUpperCase() };
  });
</script>

{#if route.view === "screen" && route.code}
  {#key route.code}<Screen code={route.code} />{/key}
{:else if route.view === "play" && route.code}
  {#key route.code}<Phone code={route.code} />{/key}
{:else}
  <Hub />
{/if}
