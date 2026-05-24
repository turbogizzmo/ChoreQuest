export function pickRespawnPoint({ enemies = [], fallback, candidates = [] }) {
  if (!fallback) return null;

  const activeEnemies = enemies.filter((enemy) => enemy?.active !== false);
  if (activeEnemies.length === 0) return fallback;

  const points = [fallback, ...candidates].filter(Boolean);
  if (points.length === 0) return fallback;

  let bestPoint = fallback;
  let bestScore = -1;

  points.forEach((point) => {
    let nearestEnemyDistance = Infinity;
    activeEnemies.forEach((enemy) => {
      const dx = enemy.x - point.x;
      const dy = enemy.y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      nearestEnemyDistance = Math.min(nearestEnemyDistance, distance);
    });
    if (nearestEnemyDistance > bestScore) {
      bestScore = nearestEnemyDistance;
      bestPoint = point;
    }
  });

  return bestPoint;
}
