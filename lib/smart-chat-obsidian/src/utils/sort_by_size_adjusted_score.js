// sort by quotient of similarity divided by len DESC
function sort_by_size_adjusted_score(nearest) {
  // re-sort by quotient of similarity divided by len DESC
  nearest = nearest.sort((a, b) => {
    const a_score = a.score / a.item.size;
    const b_score = b.score / b.item.size;
    // if a is greater than b, return -1
    if (a_score > b_score)
      return -1;
    // if a is less than b, return 1
    if (a_score < b_score)
      return 1;
    // if a is equal to b, return 0
    return 0;
  });
  return nearest;
}
