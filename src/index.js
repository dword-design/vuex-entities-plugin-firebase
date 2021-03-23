import { forEach, map, mapValues, omit, values } from '@dword-design/functions'
import firebase from 'firebase/app'
import { lowerCaseFirst } from 'lower-case-first'
import objectPath from 'object-path'

export default () => context => {
  const firestore = firebase.firestore()
  const auth = firebase.auth()
  let unsubscribers = []
  let user
  const execute = async _user => {
    user = _user
    if (user) {
      unsubscribers =
        context.types
        |> mapValues((type, typeName) => {
          const datePaths = type.datePaths || []
          return firestore
            .collection('users')
            .doc(user.uid)
            .collection(`${typeName |> lowerCaseFirst}s`)
            .onSnapshot(snapshot => {
              const changes =
                snapshot.docChanges()
                |> map(docChange => ({
                  id: docChange.doc.id,
                  typeName,
                  ...docChange.doc.data(),
                  ...(docChange.type === 'removed' && { _deleted: true }),
                }))
              changes.forEach(change =>
                datePaths.forEach(datePath => {
                  const timestamp = objectPath.get(change, datePath)
                  if (timestamp !== undefined) {
                    objectPath.set(change, datePath, timestamp.toDate())
                  }
                })
              )
              context.store.dispatch('entities/inject', changes)
            })
        })
        |> values
    } else {
      forEach(unsubscribers, unsubscriber => unsubscriber())
      await context.store.dispatch('entities/reset')
    }
  }
  auth.onAuthStateChanged(execute)
  return {
    onPersist: payload => {
      const batch = firestore.batch()
      forEach(payload.changes, change => {
        const ref = firestore
          .collection('users')
          .doc(user.uid)
          .collection(`${change.typeName |> lowerCaseFirst}s`)
          .doc(change.id)
        if (change._deleted) {
          batch.delete(ref)
        } else {
          batch.set(
            ref,
            change
              |> omit(['id', 'typeName'])
              |> mapValues(value =>
                value === undefined
                  ? firebase.firestore.FieldValue.delete()
                  : value
              ),
            { merge: true }
          )
        }
      })
      return batch.commit()
    },
  }
}
