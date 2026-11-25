<script>
  // Never cleared: the timer keeps this component alive forever.
  let ticks = $state(0);
  setInterval(() => ticks++, 10);
</script>

<p>{ticks}</p>
