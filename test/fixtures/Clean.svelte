<script lang="ts">
  let ticks: number = $state(0);
  $effect(() => {
    const id = setInterval(() => ticks++, 10);
    return () => clearInterval(id);
  });
</script>

<p>{ticks}</p>
