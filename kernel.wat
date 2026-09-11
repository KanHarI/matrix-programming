(module
  (memory (export "memory") 1)
  (func (export "multiply") (param $n i32) (param $offsets i32) (param $cols i32) (param $weights i32) (param $state i32) (param $raw i32)
    (local $row i32) (local $entry i32) (local $end i32) (local $sum i64)
    (block $done
      (loop $rows
        (br_if $done (i32.ge_u (local.get $row) (local.get $n)))
        (local.set $entry (i32.load (i32.add (local.get $offsets) (i32.mul (local.get $row) (i32.const 4)))))
        (local.set $end (i32.load (i32.add (local.get $offsets) (i32.mul (i32.add (local.get $row) (i32.const 1)) (i32.const 4)))))
        (local.set $sum (i64.const 0))
        (block $rowdone
          (loop $entries
            (br_if $rowdone (i32.ge_u (local.get $entry) (local.get $end)))
            (local.set $sum (i64.add (local.get $sum)
              (i64.mul
                (i64.extend_i32_s (i32.load (i32.add (local.get $weights) (i32.mul (local.get $entry) (i32.const 4)))))
                (i64.extend_i32_u (i32.load (i32.add (local.get $state)
                  (i32.mul (i32.load (i32.add (local.get $cols) (i32.mul (local.get $entry) (i32.const 4)))) (i32.const 4))))))))
            (local.set $entry (i32.add (local.get $entry) (i32.const 1)))
            (br $entries)))
        (i64.store (i32.add (local.get $raw) (i32.mul (local.get $row) (i32.const 8))) (local.get $sum))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rows))))
  (func (export "rectify") (param $n i32) (param $raw i32) (param $bounds i32) (param $next i32) (result i32)
    (local $row i32) (local $value i64)
    (block $done
      (loop $rows
        (br_if $done (i32.ge_u (local.get $row) (local.get $n)))
        (local.set $value (i64.load (i32.add (local.get $raw) (i32.mul (local.get $row) (i32.const 8)))))
        (if (i64.lt_s (local.get $value) (i64.const 0)) (then (local.set $value (i64.const 0))))
        (if (i64.gt_u (local.get $value) (i64.extend_i32_u (i32.load (i32.add (local.get $bounds) (i32.mul (local.get $row) (i32.const 4))))))
          (then (return (i32.add (local.get $row) (i32.const 1)))))
        (i32.store (i32.add (local.get $next) (i32.mul (local.get $row) (i32.const 4))) (i32.wrap_i64 (local.get $value)))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rows)))
    (i32.const 0)))
